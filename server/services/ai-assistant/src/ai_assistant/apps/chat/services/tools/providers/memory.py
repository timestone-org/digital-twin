"""长期记忆这一路来源：记一条、查最像的几条（ADR-0030）。

⚠ 单独一路 provider 而不是塞进 `server.py`：它依赖的是仓储与嵌入档，不是
platform 的业务面；而且 `server.py` 已经贴着模块行数闸。加一路来源 = 加一个
文件 + 注册表一行，这正是层 5 那道接缝的用途（ADR-0029）。

⚠ **归属者从签名身份头取，绝不从模型的入参取。** 模型自报一个别人的 owner_id
就能读到别人记的东西——那正是本模块唯一的安全条款要防的（ADR-0030 决策四）。
头是边缘注入并签名的，进到这里之前已经验过。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from ai_assistant.apps.chat.services.memory.ports import (
    Knowledge,
    LongTermStore,
)
from ai_assistant.apps.chat.services.tools.ports import UnknownTool
from ai_assistant.apps.chat.services.tools.shapes import (
    ToolSpec,
    integer_schema,
    object_schema,
    string_schema,
)
from lib.auth.edge_headers import HEADER_USER_ID

# 一个工具的实现：收一袋参数，给一份结果
ToolHandler = Callable[[dict[str, Any]], Awaitable[Any]]

MAX_TITLE_CHARS = 200
MAX_BODY_CHARS = 2000
DEFAULT_LIMIT = 5
MAX_LIMIT = 20

# ⚠ 本期只写 `user` 档。`project` 在库里与 `Scope` 里都留着，但工具不收它：
# 助手是纯消费方，项目 id 只能问 platform 要，而模型自报的那个不可信
# （上游也没有「按 id 读一个大屏」的端点，翻第一页清单碰运气不算可信来源）。
# 放开它要先补一次 platform 侧的授权校验——在那之前，宁可少一档也不写错归属。

MEMORY_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="memory.remember",
        description=(
            "把用户交代的一条**长期口径**记下来，以后每次对话都查得到。"
            "用户说「记住…」「以后都按…来」「这个项目里 X 指的是 Y」时用它。"
            "⚠ 只记**跨会话仍然成立**的东西：本项目的命名口径、用户的偏好、"
            "现场的约定。这一轮的中间结论不要记——它下一句话就可能变，"
            "而记岔了的口径会被以后每一轮当成事实。"
            "⚠ 记之前先 `memory.search` 查一次：同一件事记两遍，"
            "以后召回出来的是两条互相打架的口径。"
            "⚠ 本部署没接嵌入档时**仍然记得住**，但暂时检索不到——"
            "回执会如实说，那时要转告用户。"
        ),
        parameters=object_schema(
            {
                "title": string_schema(
                    "一句话标题，以后按它认出这条；如「1 号机组的别名」"
                ),
                "body": string_schema("正文：把口径说清楚，越具体越好"),
            },
            ["title", "body"],
        ),
        runs_on="server",
    ),
    ToolSpec(
        name="memory.search",
        description=(
            "查本人记过的长期口径。**动手之前先查一次**——用户上次交代过的"
            "命名、单位、约定都在这里，凭空再问一遍会显得没记性。"
            "⚠ 查不到不等于没有：本部署没接嵌入档时这里恒为空，回执会说清。"
        ),
        parameters=object_schema(
            {
                "query": string_schema("要查什么，用人话描述"),
                "limit": integer_schema(
                    f"最多回几条，缺省 {DEFAULT_LIMIT}，上限 {MAX_LIMIT}"
                ),
            },
            ["query"],
        ),
        runs_on="server",
    ),
)


@dataclass(frozen=True)
class MemoryTools:
    """长期记忆这一路来源：规格与实现收在同一个对象上。

    按请求造——它握着这一次的签名身份头，而归属者从那里取。
    """

    # ⚠ 依赖 port 而不是具体仓储：换实现（将来的 pgvector）不动这里，
    # 用例也注得进假件。没接上时是 `None`——规格照样进表（见 `tools/registry.py`
    # 的理由），由 `run` 抛一句点名的错，而不是让两份清单漂开
    store: LongTermStore | None = None
    headers: dict[str, str] = field(default_factory=dict[str, str])

    # 这一路在注册表里的名字。⚠ 不加类型标注：加了它就成了 dataclass 字段，
    # 出现在构造签名里，而调用点没有任何理由去改它
    name = "memory"

    def specs(self) -> tuple[ToolSpec, ...]:
        """这一路提供哪些工具。"""
        return MEMORY_SPECS

    async def run(self, name: str, arguments: dict[str, Any]) -> Any:
        """按名字跑一个。认不出就抛。

        Args: name, arguments。
        """
        run = self._handlers().get(name)
        if run is None:
            raise UnknownTool(f"没有这个工具：{name}")
        return await run(arguments)

    def _handlers(self) -> dict[str, ToolHandler]:
        """工具名 → 实现。

        ⚠ 查表而不是一串 `if`，与 `server.py` 同一口径：契约闸逐路读这张表来
        回答「规格里有而没人实现的是哪个」，`if` 串它读不出来。
        """
        return {
            "memory.remember": self._remember,
            "memory.search": self._search,
        }

    async def _remember(self, arguments: dict[str, Any]) -> Any:
        store = self._store()
        owner = self._owner()
        title = _text(arguments, "title")[:MAX_TITLE_CHARS]
        body = _text(arguments, "body")[:MAX_BODY_CHARS]
        found = await store.remember(
            Knowledge(scope="user", owner_id=owner, title=title, body=body)
        )
        ranked = store.can_rank
        return {
            "ok": True,
            "id": found,
            "is_searchable": ranked,
            "note": (
                "记下了，以后每次对话都查得到。"
                if ranked
                else "记下了，但本部署没接嵌入档，这条暂时检索不到——"
                "接上之后下一次检索会自动补算。请把这件事告诉用户。"
            ),
        }

    async def _search(self, arguments: dict[str, Any]) -> Any:
        store = self._store()
        owner = self._owner()
        query = _text(arguments, "query")
        limit = _limit(arguments.get("limit"))
        hits = await store.search(query, "user", owner, limit)
        return {
            "hits": [
                {
                    "id": one.id,
                    "title": one.title,
                    "body": one.body,
                    "score": round(one.score, 4),
                }
                for one in hits
            ],
            "note": (
                "按语义相似度排序，分数越高越像。"
                if store.can_rank
                else "⚠ 本部署没接嵌入档，长期记忆检索用不了——"
                "这里恒为空，不代表用户没记过东西。"
            ),
        }

    def _store(self) -> LongTermStore:
        if self.store is None:
            raise UnknownTool(
                "长期记忆还没接上仓储：`build_registry` 没拿到 `sessions`"
            )
        return self.store

    def _owner(self) -> str:
        """这一次的归属者，取自边缘签名的身份头。

        ⚠ 取不到就抛而不是回落成一个空串或「匿名」：那样一来所有取不到身份的
        请求会共用同一格记忆，互相读得到对方记的东西。
        """
        wanted = HEADER_USER_ID.lower()
        for name, value in self.headers.items():
            if name.lower() == wanted and value.strip():
                return value.strip()
        raise UnknownTool("这一次请求没有身份头，记不了也查不了")


def _text(arguments: dict[str, Any], name: str) -> str:
    given = arguments.get(name)
    if not isinstance(given, str) or not given.strip():
        raise UnknownTool(f"少了参数 {name}")
    return given.strip()


def _limit(given: object) -> int:
    if not isinstance(given, int) or given < 1:
        return DEFAULT_LIMIT
    return min(given, MAX_LIMIT)
