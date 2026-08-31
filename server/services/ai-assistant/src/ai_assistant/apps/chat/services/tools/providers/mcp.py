"""外部 MCP server 那一路来源（ADR-0031）。

MCP 工具是**服务端工具**：跑在本进程里，与浏览器侧那批井水不犯河水。所以
「MCP 与客户端工具怎么共存」不是问题，问题全在 ADR 的那六条边界上。

⚠ **名字用点号 `mcp.<server>.<tool>`，不用 `mcp__server__tool`。**
ADR-0031 决策三原话是「不能用点号」，那一句是错的：订阅账号那一路的
`wire_names` 出去时把 `.` 换成 `__`、回来时把 `__` 换回 `.`，所以规范名里
**不许出现 `__`**——`mcp__weather__forecast` 会被换回 `mcp.weather.forecast`，
往返对不上，而现象是选了订阅账号档之后这一批工具整批派发失败。
`test_codex_wire_names.py` 有一条用例钉着这条不变量。

⚠ **默认只读。** MCP 的 `readOnlyHint` 是可选的，缺了那一格的工具可能删东西，
所以说不清就当成写操作、不下发。放行的代价不可逆，拦下的代价只是白名单里补一行。

⚠ **工具描述是外部可控的文本。** 它会原样进提示词——那是一条注入面。这里只把它
当**数据**搬运，不解释、不执行；日志与审计里也不许记全文。
"""

import re
from dataclasses import dataclass
from typing import Any

from ai_assistant.apps.chat.services.tools.ports import UnknownTool
from ai_assistant.apps.chat.services.tools.shapes import ToolSpec
from ai_assistant.upstream.mcp import McpCatalog, McpToolInfo

# 规范名的前缀段
PREFIX = "mcp"
# 这一路在注册表里的名字。⚠ 单拎成常量：`advance_service` 要按它挑出「这一轮
# 才知道的那几个规格」，两处各写一个字面量迟早漂开
PROVIDER = "mcp"
_DOT = "."

# server 名与工具名许用的字形。⚠ 不许有 `.`（它是命名空间分隔符），也不许有
# `__`（那是订阅账号那一路给 `.` 用的替身，出现了就换不回来）
_SEGMENT = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$")
_WIRE_DOT = "__"
# 规范名的段数：`mcp` + server + tool
_SEGMENTS = 3


class BadToolName(ValueError):
    """server 报了一个我们没法安全命名的工具。"""


def canonical_name(server: str, tool: str) -> str:
    """`mcp.<server>.<tool>`。字形不合法时抛。

    Args: server, tool。
    """
    for segment in (server, tool):
        if not _SEGMENT.fullmatch(segment) or _WIRE_DOT in segment:
            raise BadToolName(
                f"MCP 名字里不许出现点号或连续下划线：{server}/{tool}"
            )
    return f"{PREFIX}{_DOT}{server}{_DOT}{tool}"


def split_name(name: str) -> tuple[str, str] | None:
    """规范名 → `(server, tool)`；不是 MCP 的名字给 `None`。

    Args: name。
    """
    parts = name.split(_DOT)
    if len(parts) != _SEGMENTS or parts[0] != PREFIX:
        return None
    return parts[1], parts[2]


@dataclass(frozen=True)
class McpTools:
    """外部 MCP 那一路。

    ⚠ `specs()` 读的是目录**此刻的快照**，不现问网络：注册表在造出来那一刻取一次
    规格，之后分派不再问 provider（`tools/registry.py` 文件头）。快照由
    `McpCatalog.refresh()` 在每轮开头刷一次。
    """

    catalog: McpCatalog
    # 允许下发的**写操作**规范名。⚠ 白名单之外的写操作一律不出现在清单里，
    # 不是「下发了再拦」：模型看得见就会调，拦一次换一次往返，而那次往返里
    # 它多半会换个说法再试一遍
    write_allowed: frozenset[str] = frozenset()

    @property
    def name(self) -> str:
        """这一路来源在注册表里的名字。"""
        return PROVIDER

    def specs(self) -> tuple[ToolSpec, ...]:
        """此刻问得到、且许下发的那些。"""
        return tuple(
            spec
            for spec in (self._spec_of(one) for one in self.catalog.tools())
            if spec is not None
        )

    async def run(self, name: str, arguments: dict[str, Any]) -> Any:
        """派到对应的 server 上跑。

        ⚠ 这里**再查一次白名单**。`specs()` 已经拦过一次，但那是「模型看不见」；
        模型仍可能从历史里翻出一个上一版配置下发过的名字，而那时白名单可能已经
        收紧了。

        Args: name, arguments。
        """
        split = split_name(name)
        if split is None:
            raise UnknownTool(f"不是 MCP 工具名：{name}")
        server, tool = split
        info = self.catalog.find(server, tool)
        if info is None or self._spec_of(info) is None:
            raise UnknownTool(f"这一轮没有这个 MCP 工具：{name}")
        return await self.catalog.call(server, tool, arguments)

    def _spec_of(self, info: McpToolInfo) -> ToolSpec | None:
        """一条目录项 → 一份工具规格；不许下发的给 `None`。

        Args: info。
        """
        try:
            name = canonical_name(info.server, info.tool)
        except BadToolName:
            # 名字不合法的那一个丢掉，其余照常——一个坏名字不该让整路缺席
            return None
        if not info.is_read_only and name not in self.write_allowed:
            return None
        return ToolSpec(
            name=name,
            description=info.description,
            parameters=_object_schema(info.input_schema),
            runs_on="server",
        )


def _object_schema(given: dict[str, Any]) -> dict[str, Any]:
    """server 给的入参 schema；不成形时退回一只空对象。

    ⚠ 退回空对象而不是原样透传：形状不对的 schema 会让端点回一条 400，
    而那条 400 不会说是哪个工具的哪一格不对。

    Args: given。
    """
    if given.get("type") != "object":
        return {"type": "object", "properties": {}, "required": []}
    return given
