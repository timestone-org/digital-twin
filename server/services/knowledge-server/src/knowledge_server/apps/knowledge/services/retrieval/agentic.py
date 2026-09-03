"""带补检的检索循环：改写 → 召回 → 评分 → 不够就再来一轮 → 合成带引用的答案。

⚠ 它是**策略之一**，不是「更好的 hybrid」：它多花几次模型调用换覆盖率，
而多数提问一次混合召回就够了。默认那一路仍是 `hybrid`。

⚠ 循环有**硬上限**（轮数、召回条数）。到顶就把手上最好的那一批连同
「我没查全」一起交出去——没有上限的话，一次问不到的提问会把 worker 占住
（ADR-0035 决策六）。

⚠ 没接对话档时它**如实不可用**，不悄悄退化成 `hybrid`：悄悄退化的表现是
「质量忽然变差了」，而没有任何一处报错。

⚠ 重排在**合池之后**做一次，对着原问题（ADR-0042）：让每条改写式各排一次的话，
几路的分数不是同一个基准，合池之后按它们排序等于按噪声排序——而那笔钱还是
按条算的。
"""

import json
from dataclasses import dataclass, field
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.services.llm import (
    Answerer,
    AnswerUnavailable,
)
from knowledge_server.apps.knowledge.services.reranking import (
    NullReranker,
    Reranker,
)
from knowledge_server.apps.knowledge.services.retrieval.hybrid import Hybrid
from knowledge_server.apps.knowledge.services.retrieval.ports import (
    Hit,
    RetrievalRequest,
    RetrievalResult,
    RetrievalUnavailable,
)
from knowledge_server.apps.knowledge.services.retrieval.reranked import (
    candidate_width,
    reranked,
)

AGENTIC = "agentic"

# 最多跑几轮。⚠ 有上限：没有上限的话，一次问不到的提问会一直改写下去
MAX_ROUNDS = 3
# 一次改写出几条检索式
MAX_QUERIES = 3

_REWRITE_SYSTEM = (
    "你在为一个工业资料知识库改写检索式。把用户的问题拆成 1-3 条**互不重复**"
    "的检索式，每条尽量短。设备编号、型号、标准号要原样保留——它们在向量空间"
    "里几乎没有区分度，只能靠字面命中。只回一个 JSON 数组，别的什么都不要写。"
)
_GRADE_SYSTEM = (
    "你在判断一批资料片段够不够回答一个问题。只回 yes 或 no，别的什么都不要写。"
    "够就回 yes。不够就回 no——宁可多查一轮，也不要拿半份资料下结论。"
)
_ANSWER_SYSTEM = (
    "你在按给定的资料片段回答问题。**只用片段里的内容**，片段里没有的就说"
    "没查到，不要补充常识、不要猜。每一句结论后面挂上它依据的片段角标，"
    "形如 [1]。角标必须真的对应下面某一段。"
)


@dataclass(frozen=True)
class Agentic:
    """改写、召回、评分、补检、重排、合成。"""

    hybrid: Hybrid
    answerer: Answerer
    # 重排那一路。⚠ 在**合池之后**对着原问题排一次，而不是让每条改写式各排
    # 一次：各自的分数不是同一个基准，合池之后按它们排序等于按噪声排序，
    # 而每条改写式各排一次的钱是白花的
    reranker: Reranker = field(default_factory=NullReranker)
    name: str = AGENTIC
    is_llm_backed: bool = True
    is_answering: bool = True
    max_rounds: int = MAX_ROUNDS

    async def retrieve(
        self, session: AsyncSession, request: RetrievalRequest
    ) -> RetrievalResult:
        """跑一次带补检的检索，并把答案一并合成出来。

        Args: session, request。
        """
        if not self.answerer.can_answer:
            raise RetrievalUnavailable("这套部署没接对话档，agentic 策略用不了")
        seen: dict[str, Hit] = {}
        rounds = 0
        is_complete = False
        query = request.query
        while rounds < self.max_rounds and not is_complete:
            rounds += 1
            for one in await self._round(session, request, query):
                seen[str(one.chunk_id)] = one
            found = list(seen.values())
            is_complete = await self._is_enough(request.query, found)
            query = request.query
        hits, note = await self._ranked(request, list(seen.values()))
        return RetrievalResult(
            hits=hits,
            strategy=self.name,
            rounds=rounds,
            is_complete=is_complete,
            answer=await self._answer(request.query, hits),
            note="；".join(
                one
                for one in (
                    "" if is_complete else "到了轮数上限，这批资料可能没覆盖全",
                    note,
                )
                if one
            ),
        )

    async def _ranked(
        self, request: RetrievalRequest, pool: list[Hit]
    ) -> tuple[tuple[Hit, ...], str]:
        """把几轮攒下的池子排定，并回一句「这次出了什么事」。

        ⚠ 重排对着**原问题**做，不对着最后一条改写式：用户问的是前者，
        而改写式只是为了把资料捞出来。

        Args: request, pool。
        """
        wanted = (
            candidate_width(request.limit)
            if self.reranker.can_rerank
            else request.limit
        )
        return await reranked(
            self.reranker, request.query, _best(pool, wanted), request.limit
        )

    async def _round(
        self, session: AsyncSession, request: RetrievalRequest, query: str
    ) -> list[Hit]:
        """改写一次，把改出来的每条检索式各跑一遍混合召回。

        Args: session, request, query。
        """
        made: list[Hit] = []
        for one in await self._rewritten(query):
            found = await self.hybrid.retrieve(
                session,
                RetrievalRequest(
                    base_id=request.base_id, query=one, limit=request.limit
                ),
            )
            made.extend(found.hits)
        return made

    async def _rewritten(self, query: str) -> list[str]:
        """把问题改写成几条检索式；改不出来就用原句。

        ⚠ 改不出来**退回原句**而不是抛：改写只是锦上添花，而一次 JSON 解析
        失败不该让整次提问失败。

        Args: query。
        """
        try:
            reply = await self.answerer.complete(_REWRITE_SYSTEM, query)
        except AnswerUnavailable:
            raise
        rows = _parsed_queries(reply)
        return rows[:MAX_QUERIES] or [query]

    async def _is_enough(self, query: str, hits: list[Hit]) -> bool:
        """这批片段够不够回答；判不出来就当不够。

        ⚠ 判不出来当**不够**：多查一轮的代价是几秒，而拿半份资料下结论的
        代价是一个看着很确定的错答案。

        Args: query, hits。
        """
        if not hits:
            return False
        reply = await self.answerer.complete(
            _GRADE_SYSTEM, _as_prompt(query, hits)
        )
        return reply.strip().lower().startswith("yes")

    async def _answer(self, query: str, hits: tuple[Hit, ...]) -> str:
        """按片段合成一段带角标的答案。

        Args: query, hits。
        """
        if not hits:
            return ""
        return await self.answerer.complete(
            _ANSWER_SYSTEM, _as_prompt(query, list(hits))
        )


def _parsed_queries(reply: str) -> list[str]:
    """把模型回的那段 JSON 解成检索式列表；解不动给空表。

    Args: reply。
    """
    text = reply.strip()
    start, end = text.find("["), text.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        rows: object = json.loads(text[start : end + 1])
    except ValueError:
        return []
    if not isinstance(rows, list):
        return []
    return [
        one.strip()
        for one in cast("list[object]", rows)
        if isinstance(one, str) and one.strip()
    ]


def _as_prompt(query: str, hits: list[Hit]) -> str:
    """把问题与片段摊成一段提示词。

    ⚠ 角标从 1 起，且**片段顺序即角标**：模型挂 [2] 的时候，那一条必须真的是
    第二段。乱序的话引用全指错，而看着完全正常。

    Args: query, hits。
    """
    parts = [f"问题：{query}", "", "资料片段："]
    for index, one in enumerate(hits, start=1):
        where = one.locator.label()
        head = f"[{index}] {one.document_title}"
        parts.append(f"{head}{f'·{where}' if where else ''}\n{one.text}")
    return "\n\n".join(parts)


def _best(hits: list[Hit], limit: int) -> tuple[Hit, ...]:
    """按分数取前几条。

    Args: hits, limit。
    """
    hits.sort(key=lambda one: one.score, reverse=True)
    return tuple(hits[:limit])
