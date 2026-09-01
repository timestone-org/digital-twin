"""知识库这一路来源：列库、检索、看整块原文。

⚠ **只出检索原语，不出一个「问答」黑盒**（ADR-0035 决策三）：助手手里握着整轮
对话的上下文，改写查询这件事它做得比任何服务端启发式都好；而「查几次、换哪个
词再查一轮」交给它自己的 `think ⇄ use_tools` 环，界面上还看得见每一步。
要一个开箱即用的答案，那是非对话消费方走 `:ask` 的事。

⚠ 全是**只读**的。建库、传文档、跑同步都在知识库自己的界面上做——助手能动的
东西越少，它被当成越权通道的可能就越小。

⚠ 身份头原样转发，知识库按用户自己的权限码判定：助手检索不到用户本来检索
不到的库。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, cast

from ai_assistant.apps.chat.services.tools.ports import UnknownTool
from ai_assistant.apps.chat.services.tools.shapes import (
    ToolSpec,
    integer_schema,
    object_schema,
    string_schema,
)
from ai_assistant.upstream import KnowledgeClient

ToolHandler = Callable[[dict[str, Any]], Awaitable[Any]]

DEFAULT_LIMIT = 6
MAX_LIMIT = 20
# 一条召回在工具结果里最多带多少字符。⚠ 有上限：一次检索十条整块正文能把
# 工作面快照与技能正文整个挤出上下文，而挤掉了哪一段从外面完全看不出来
MAX_SNIPPET_CHARS = 1_200

KNOWLEDGE_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="knowledge.list_bases",
        description=(
            "列出这个人看得见的知识库。**检索之前先列一次**——库 id 只能从"
            "这里来，凭印象填一个多半是 404。"
            "⚠ 一个都没有不等于这套部署没接知识库，也可能是这个人没有权限。"
        ),
        parameters=object_schema({}, []),
        runs_on="server",
    ),
    ToolSpec(
        name="knowledge.search",
        description=(
            "在一个知识库里检索资料。"
            "⚠ **一次只问一件事**：把「A 的上限是多少，另外 B 怎么保养」拆成"
            "两次检索，混在一句里两边都召不准。"
            "⚠ 设备编号、型号、标准号（如 K1_TMT_HOT、GB/T 4728）**原样写进"
            "查询**：它们在语义上几乎没有区分度，只能靠字面命中。"
            "⚠ 召回不足时**换个说法再查一轮**（换同义词、去掉限定、只留编号），"
            "不要拿半份资料下结论。"
            "⚠ 每条回执带 `document_title` 与 `locator`，答复里每句结论后面"
            "要挂上它们——指不出出处的答案，用户没法核对，也就不敢用。"
        ),
        parameters=object_schema(
            {
                "base_id": string_schema("哪个库，取自 knowledge.list_bases"),
                "query": string_schema("要查什么，用人话描述"),
                "limit": integer_schema(
                    f"最多回几条，缺省 {DEFAULT_LIMIT}，上限 {MAX_LIMIT}"
                ),
            },
            ["base_id", "query"],
        ),
        runs_on="server",
    ),
)


@dataclass(frozen=True)
class KnowledgeTools:
    """知识库这一路来源：规格与实现收在同一个对象上。

    按请求造——它握着这一次要转发的签名身份头。
    """

    client: KnowledgeClient | None = None
    headers: dict[str, str] = field(default_factory=dict[str, str])

    # 这一路在注册表里的名字。⚠ 不加类型标注：加了它就成了 dataclass 字段，
    # 出现在构造签名里，而调用点没有任何理由去改它
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
        """工具名 → 实现。查表而不是一串 `if`，与别的 provider 同一口径。"""
        return {
            "knowledge.list_bases": self._list_bases,
            "knowledge.search": self._search,
        }

    def _upstream(self) -> KnowledgeClient:
        if self.client is None:
            raise UnknownTool(
                "这套部署没有接知识库：编排里没起 knowledge-server"
            )
        return self.client

    async def _list_bases(self, arguments: dict[str, Any]) -> Any:
        del arguments
        made = await self._upstream().list_bases(self.headers)
        rows = _items_of(made)
        return {
            "bases": [
                {
                    "id": str(one.get("id", "")),
                    "name": str(one.get("name", "")),
                    "description": str(one.get("description", "")),
                    "document_count": one.get("document_count", 0),
                }
                for one in rows
            ],
            "note": (
                "库 id 只能从这里来。一个都没有时，先问用户这套部署有没有"
                "建过知识库，别自己编一个 id。"
            ),
        }

    async def _search(self, arguments: dict[str, Any]) -> Any:
        base_id = _text(arguments, "base_id")
        made = await self._upstream().search(
            self.headers,
            base_id,
            {
                "query": _text(arguments, "query"),
                "limit": _limit(arguments.get("limit")),
            },
        )
        return _search_result(made)


def _search_result(made: object) -> dict[str, Any]:
    """把检索回执摊成给模型看的样子。

    ⚠ `note` 原样带出来：「这套部署没接嵌入档，本次只走了关键词那一路」这类
    话必须传到模型眼前，否则它会把一次退化的召回当成全部事实。

    Args: made。
    """
    if not isinstance(made, dict):
        return {"hits": [], "note": "知识库回了一个读不懂的形状"}
    body = cast("dict[str, Any]", made)
    hits = body.get("hits")
    rows = cast("list[Any]", hits) if isinstance(hits, list) else []
    return {
        "hits": [
            _hit_of(cast("dict[str, Any]", one))
            for one in rows
            if isinstance(one, dict)
        ],
        "strategy": body.get("strategy", ""),
        "note": body.get("note", ""),
    }


def _hit_of(row: dict[str, Any]) -> dict[str, Any]:
    locator = row.get("locator")
    where = ""
    if isinstance(locator, dict):
        where = str(cast("dict[str, Any]", locator).get("label", ""))
    return {
        "chunk_id": row.get("chunk_id", ""),
        "document_title": row.get("document_title", ""),
        "locator": where,
        "heading_path": row.get("heading_path", ""),
        "text": str(row.get("text", ""))[:MAX_SNIPPET_CHARS],
        "score": row.get("score", 0),
        "why": row.get("why", ""),
    }


def _items_of(made: object) -> list[dict[str, Any]]:
    if not isinstance(made, dict):
        return []
    items = cast("dict[str, Any]", made).get("items")
    if not isinstance(items, list):
        return []
    return [one for one in cast("list[Any]", items) if isinstance(one, dict)]


def _text(arguments: dict[str, Any], name: str) -> str:
    given = arguments.get(name)
    if not isinstance(given, str) or not given.strip():
        raise UnknownTool(f"少了参数 {name}")
    return given.strip()


def _limit(given: object) -> int:
    if not isinstance(given, int) or given < 1:
        return DEFAULT_LIMIT
    return min(given, MAX_LIMIT)
