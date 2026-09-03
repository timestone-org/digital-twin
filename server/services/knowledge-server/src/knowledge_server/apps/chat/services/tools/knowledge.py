"""知识库这一路工具：列库、检索、看整块原文（连前后各一块）。

⚠ **只出检索原语，不出一个「问答」黑盒**（ADR-0035 决策三）：模型手里握着整轮
对话的上下文，改写查询这件事它做得比任何服务端启发式都好；「查几次、换哪个词
再查一轮」交给它自己的循环，界面上还看得见每一步。

⚠ 全是**只读**的（docs/KNOWLEDGE_CHAT_DESIGN.md §3）：让模型能改库里的东西，
等于让一句话就能改掉所有人以后检索到的内容，而这件事没有撤销栈。

⚠ **在进程内直调服务层**，不走 HTTP：这是把对话放进 knowledge-server 的红利——
不用转发身份头、不多一跳、不会撞上委托身份几十秒就到期那个坑。权限在端点
入口已经按 `knowledge:use` 判过。

⚠ 会话的检索范围在这一层**硬过滤**（ADR-0044）：三个工具各自判一次，越界的
当场抛。写在提示词里是不够的——模型多数时候听话、偶尔不听，而不听的那一次
没有任何一处报错，用户看到的是一条来自他明确排除掉的库的答案。
`kb.read_chunk` 那一道最容易漏：前两个拦住了，模型仍可能从历史消息里翻出一个
越界的 `chunk_id`。
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from knowledge_server.apps.chat.services.scope import BaseScope
from knowledge_server.apps.knowledge.services import (
    HitOut,
    KnowledgeBaseNotFound,
    RetrievalUnavailable,
    SearchIn,
    chunk_service,
    library_service,
    search_service,
)
from knowledge_server.apps.knowledge.services.retrieval import (
    RetrievalStrategy,
)
from llmcore.tools.ports import UnknownTool
from llmcore.tools.shapes import (
    ToolSpec,
    integer_schema,
    object_schema,
    string_schema,
)

ToolHandler = Callable[[dict[str, Any]], Awaitable[Any]]
Sessions = Callable[[], Any]

LIST_BASES = "kb.list_bases"
SEARCH = "kb.search"
READ_CHUNK = "kb.read_chunk"

DEFAULT_LIMIT = 6
MAX_LIMIT = 20
# 列库最多列几个。⚠ 有上限：一次把几百个库摊给模型，它会把上下文花在挑库上
MAX_BASES = 50
# 一条召回在工具结果里最多带多少字符。⚠ 有上限：一次检索十条整块正文能把
# 常驻提示词与历史整个挤出上下文
MAX_SNIPPET_CHARS = 1_200
# 看整块时前后各带几块
NEIGHBOURS = 1

KNOWLEDGE_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name=LIST_BASES,
        description=(
            "列出**这次对话能查的**知识库。**检索之前先列一次**——库 id 只能"
            "从这里来，凭印象填一个多半是 404。"
            "⚠ 用户可能把这次对话的范围收窄到了其中几个库；这里列出来的就是"
            "范围内的那几个，范围外的库查不了。"
            "⚠ 一个都没有时先问用户这套部署建没建过库，别自己编一个 id。"
        ),
        parameters=object_schema({}, []),
        runs_on="server",
    ),
    ToolSpec(
        name=SEARCH,
        description=(
            "在一个知识库里检索资料。"
            "⚠ **一次只问一件事**：把「A 的上限是多少，另外 B 怎么保养」拆成"
            "两次检索。"
            "⚠ 设备编号、型号、标准号（如 K1_TMT_HOT、GB/T 4728）**原样写进"
            "查询**：它们在语义上几乎没有区分度，只能靠字面命中。"
            "⚠ 召回不足时**换个说法再查一轮**，或换一个范围内的库，不要拿"
            "半份资料下结论。"
            "⚠ 每条回执带 `base_name`、`document_title` 与 `locator`，答复里"
            "每句结论后面要挂角标并在末尾列出这三样——指不出出处的答案，"
            "用户没法核对。"
        ),
        parameters=object_schema(
            {
                "base_id": string_schema("哪个库，取自 kb.list_bases"),
                "query": string_schema("要查什么，用人话描述"),
                "limit": integer_schema(
                    f"最多回几条，缺省 {DEFAULT_LIMIT}，上限 {MAX_LIMIT}"
                ),
            },
            ["base_id", "query"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name=READ_CHUNK,
        description=(
            "看一条召回所在的整块原文，连前后各一块一起给。"
            "某一段要看上下文才判得准时用它；`chunk_id` 取自 kb.search 的回执。"
        ),
        parameters=object_schema(
            {"chunk_id": string_schema("哪一块，取自 kb.search 的回执")},
            ["chunk_id"],
        ),
        runs_on="server",
    ),
)


@dataclass(frozen=True)
class KnowledgeTools:
    """知识库这一路：规格与实现收在同一个对象上。"""

    sessions: Sessions
    strategies: tuple[RetrievalStrategy, ...]
    # 这次对话能取哪几个库的数。⚠ 经依赖传进来而不是读模块级状态：两个用户的
    # 两个回合在同一个进程里并发跑，模块级的那一份会被后来的那个覆盖
    scope: BaseScope

    # 这一路在注册表里的名字。⚠ 不加类型标注：加了它就成了 dataclass 字段
    name = "knowledge"

    def specs(self) -> tuple[ToolSpec, ...]:
        """这一路提供哪些工具。"""
        return KNOWLEDGE_SPECS

    async def run(self, name: str, arguments: dict[str, Any]) -> Any:
        """按名字跑一个。认不出就抛。

        Args: name, arguments。
        """
        run = self._handlers().get(name)
        if run is None:
            raise UnknownTool(f"没有这个工具：{name}")
        return await run(arguments)

    def _handlers(self) -> dict[str, ToolHandler]:
        """工具名 → 实现。查表而不是一串 `if`。"""
        return {
            LIST_BASES: self._list_bases,
            SEARCH: self._search,
            READ_CHUNK: self._read_chunk,
        }

    async def _list_bases(self, arguments: dict[str, Any]) -> Any:
        del arguments
        async with self.sessions() as session:
            rows, total = await library_service.brief_bases(
                session, limit=MAX_BASES, only_ids=self.scope.ids()
            )
            return {
                "bases": [
                    {
                        "id": str(one.id),
                        "name": one.name,
                        "description": one.description,
                        "strategy": one.strategy,
                        "is_indexed": one.is_indexed,
                    }
                    for one in rows
                ],
                "total": total,
                "note": (
                    f"{_scope_note(self.scope)}库 id 只能从这里来。"
                    "`is_indexed` 为假的库还没建过向量索引，只能靠关键词命中。"
                ),
            }

    async def _search(self, arguments: dict[str, Any]) -> Any:
        base_id = _uuid(arguments, "base_id")
        # ⚠ 拦在检索之前，且抛而不是回空表：空表与「这个库里确实没这句话」
        # 长得一模一样，模型会把它读成「查过了，没有」接着往下答
        self.scope.require(base_id)
        body = SearchIn(
            query=_text(arguments, "query"),
            limit=_limit(arguments.get("limit")),
        )
        async with self.sessions() as session:
            try:
                made = await search_service.search(
                    session, self.strategies, base_id, body
                )
                base = await library_service.read_base(session, base_id)
            except (KnowledgeBaseNotFound, RetrievalUnavailable) as error:
                # ⚠ 抛成工具失败而不是穿到回合外：模型拿到「这个库检索不了」
                # 往往能换一个库或换个说法，而穿出去等于整个回合断掉
                raise UnknownTool(str(error)) from error
        return {
            "hits": [_hit_of(one, base.name) for one in made.hits],
            "strategy": made.strategy,
            "note": made.note,
        }

    async def _read_chunk(self, arguments: dict[str, Any]) -> Any:
        chunk_id = _uuid(arguments, "chunk_id")
        async with self.sessions() as session:
            found = await chunk_service.read_around(session, chunk_id)
        if found is None:
            raise UnknownTool("没有这一块；chunk_id 要取自 kb.search 的回执")
        # ⚠ 这一道最容易漏：列库与检索都拦住了，模型仍可能从历史消息里翻出
        # 一个越界的 chunk_id——而那是整段原文，不是一条摘要
        self.scope.require(found.base_id)
        return {
            "document_title": found.document_title,
            "heading_path": found.heading_path,
            "locator": found.locator,
            "before": list(found.before),
            "text": found.text,
            "after": list(found.after),
        }


def _scope_note(scope: BaseScope) -> str:
    """给模型说清这次对话的范围；不限库时也说清。

    Args: scope。
    """
    if scope.bases is None:
        return "这次对话没有限定知识库，上面就是这套部署里全部的库。"
    gone = sum(1 for one in scope.bases if one.is_missing)
    tail = f"；另有 {gone} 个已经不存在、查不了。" if gone else "。"
    return (
        f"这次对话的范围被用户限定在 {len(scope.bases)} 个库，"
        f"上面列的就是范围内还在的那几个{tail}"
    )


def _hit_of(hit: HitOut, base_name: str) -> dict[str, Any]:
    """一条召回摊成给模型看的样子。

    ⚠ `base_name` 一并带上：对话是跨库的，模型挑错库时用户看不出——
    每条召回都得标明来自哪个库（ADR-0037 决策三）。

    Args: hit, base_name。
    """
    return {
        "chunk_id": str(hit.chunk_id),
        "base_name": base_name,
        "document_title": hit.document_title,
        "locator": hit.locator.label,
        "heading_path": hit.heading_path,
        "text": hit.text[:MAX_SNIPPET_CHARS],
        "score": hit.score,
        "why": hit.why,
    }


def _text(arguments: dict[str, Any], name: str) -> str:
    given = arguments.get(name)
    if not isinstance(given, str) or not given.strip():
        raise UnknownTool(f"少了参数 {name}")
    return given.strip()


def _uuid(arguments: dict[str, Any], name: str) -> uuid.UUID:
    try:
        return uuid.UUID(_text(arguments, name))
    except ValueError as error:
        raise UnknownTool(f"{name} 不是一个合法的 id") from error


def _limit(given: object) -> int:
    if not isinstance(given, int) or given < 1:
        return DEFAULT_LIMIT
    return min(given, MAX_LIMIT)
