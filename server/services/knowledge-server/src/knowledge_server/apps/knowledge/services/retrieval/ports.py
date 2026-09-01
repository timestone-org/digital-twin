"""层 6 检索编排的扩展点：一次检索怎么走。

加一种策略 = 加一个实现文件 + 注册元组里一行 + 一条契约测试（ADR-0035）。

⚠ 写死一条管线的话，每一次调整都是改调用方的函数体，而新旧两版没法同时在线
做对照——而检索质量这件事一定会反复改。注册表让「换一种检索」变成一格配置。

⚠ 打分**只排序不取舍**，并把「为什么它排在这」（`why`）一并交出去。
得分为 0 的候选一律不返回：硬凑几条出来的话，模型会以为「就这些了」然后从
里面挑一条，那比返回空表难查得多（与点位召回同源）。

⚠ **引用指到块，不指到文档**：指到文档的话，用户拿到的是「答案在这份 200 页
的手册里」，而那等于没给出处。
"""

import uuid
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.services.parsing import Locator


@dataclass(frozen=True)
class RetrievalRequest:
    """一次检索。"""

    base_id: uuid.UUID
    query: str
    limit: int


@dataclass(frozen=True)
class Hit:
    """一条召回，自带够用来核对的出处。"""

    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    text: str
    heading_path: str
    locator: Locator
    score: float
    # 它凭什么排在这。⚠ 交出去而不是自己吞掉：选哪一条由调用方定，
    # 因为只有它知道用户这句话的上下文
    why: str


@dataclass(frozen=True)
class RetrievalResult:
    """一次检索的结果。"""

    hits: tuple[Hit, ...]
    strategy: str
    # 走了几轮。单次召回的策略恒为 1，带补检的循环可以更多
    rounds: int = 1
    # 到顶了没查全吗。⚠ 如实说：`agentic` 那一路有硬上限，到顶时要把手上最好
    # 的那一批**连同「我没查全」一起**交出去，而不是装作查完了
    is_complete: bool = True
    # 给人看的一句说明。⚠ 「这个库还没建索引」这类话走这里，**不走空表**：
    # 空表与「确实没有相关内容」长得一模一样
    note: str = ""
    # 合成好的答案。⚠ 只召回不作答的策略留空串——`:ask` 据此拒掉它们，
    # 而不是把一个空答案交给用户
    answer: str = ""


@dataclass(frozen=True)
class RetrievalUnavailable(Exception):
    """这个库此刻检索不了（没配嵌入档 / 还没建过索引）。

    ⚠ 如实抛出来，不返回空表：模型会把空表读成「查过了，没有」然后接着往下走。
    """

    reason: str = ""


@runtime_checkable
class RetrievalStrategy(Protocol):
    """一种检索走法。"""

    @property
    def name(self) -> str:
        """这一路在注册表里的名字。⚠ 它同时是库上那一格的取值与数据库
        CHECK 的字面量，三处必须逐字一致。"""
        ...

    @property
    def is_llm_backed(self) -> bool:
        """这一路是不是靠一路对话档撑起来的。

        ⚠ 要而没接时它**如实不可用**，不悄悄退化成别的策略——悄悄退化的表现是
        「质量忽然变差了」，而没有任何一处报错（ADR-0035 决策二）。
        """
        ...

    @property
    def is_answering(self) -> bool:
        """这一路作不作答，还是只召回。

        ⚠ 与 `is_llm_backed` 分开：今天只有一路既要模型又作答，但「要模型」
        与「会作答」是两件事——将来接一路只用模型改写查询、仍然不作答的策略时，
        合在一起判会让 `:ask` 把它当成能作答的。
        """
        ...

    async def retrieve(
        self, session: AsyncSession, request: RetrievalRequest
    ) -> RetrievalResult:
        """跑一次检索。

        Args: session, request。
        """
        ...


@dataclass(frozen=True)
class Fused:
    """名次融合的中间结果。"""

    chunk_id: uuid.UUID
    score: float
    reasons: tuple[str, ...] = field(default_factory=tuple)


# 名次融合的平滑常数（RRF）。⚠ 取 60 是这套方法的常用值：太小则第一名一家独大，
# 太大则名次之间拉不开差距
RRF_K = 60


def fused(lanes: dict[str, list[tuple[uuid.UUID, str]]]) -> list[Fused]:
    """把几路按名次的召回融成一份。

    ⚠ 按**名次**融合而不是按分数加权：两路的分数根本不是同一个量纲
    （余弦相似度 vs trigram 相似度），加权融合要先定标，而定标参数会随语料
    漂移——名次不会。

    ⚠ 两路都命中的块自然排到前面：它在两边各拿一份倒数名次分。这正是混合检索
    的收益所在，不是巧合。

    Args: lanes（每一路的召回，已按分数降序；值是 (块 id, 为什么)）。
    """
    scores: dict[uuid.UUID, float] = {}
    reasons: dict[uuid.UUID, list[str]] = {}
    for rows in lanes.values():
        for rank, (chunk_id, why) in enumerate(rows, start=1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (RRF_K + rank)
            reasons.setdefault(chunk_id, []).append(why)
    made = [
        Fused(chunk_id=one, score=score, reasons=tuple(reasons[one]))
        for one, score in scores.items()
    ]
    made.sort(key=lambda one: one.score, reverse=True)
    return made
