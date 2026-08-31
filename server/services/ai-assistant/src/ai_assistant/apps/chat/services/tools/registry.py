"""层 5 的注册表：这套部署接了哪几路工具来源。

⚠ 注册是**显式元组**，不靠 import 副作用（ADR-0029 决策四）：隐式注册会让
「接了哪几路」取决于 import 顺序，而顺序在测试里与生产里可以不同。

⚠ provider 的生命期分两种：`ServerTools` **按请求造**（它握着这一次要转发的身份
头，做成进程级单例会让两个用户互相借用对方的身份），`ClientTools` 无状态。所以
注册表本身也按请求造。

⚠ 规格在**造注册表的那一刻取一次快照**，之后分派不再问 provider。这一条是给
MCP 那一路留的（ADR-0031）：那一路的 `specs()` 要走网络，每次分派都问一遍，
一个回合几十次工具调用就是几十次多余的往返。
"""

from dataclasses import dataclass
from typing import Any

from ai_assistant.apps.chat.services.tools.ports import (
    ToolProvider,
    UnknownTool,
)
from ai_assistant.apps.chat.services.tools.providers.client import ClientTools
from ai_assistant.apps.chat.services.tools.providers.mcp import McpTools
from ai_assistant.apps.chat.services.tools.providers.server import ServerTools
from ai_assistant.apps.chat.services.tools.shapes import ToolSpec
from ai_assistant.upstream import McpCatalog, PlatformClient


class DuplicateTool(RuntimeError):
    """两路来源报了同一个工具名。

    ⚠ 在装配期就抛，不留到运行期：重名时后注册的那一路会被前一路遮掉，而遮掉的
    是哪一个从外面完全看不出来——模型调到的是它没预期的那份实现。
    """


@dataclass(frozen=True)
class ToolRegistry:
    """这一轮的工具全集：按注册序汇总规格，按名字分派执行。"""

    providers: tuple[ToolProvider, ...]
    # 造出来那一刻的规格快照，顺序即注册序
    specs: tuple[ToolSpec, ...]
    # 工具名 → 由哪一路执行
    owners: dict[str, ToolProvider]

    async def run(self, name: str, arguments: dict[str, Any]) -> Any:
        """按名字分派。认不出的名字抛 `UnknownTool`。

        ⚠ 认不出就抛，不返回一个看起来正常的空结果：模型编一个不存在的工具名是
        常事，静默给空结果它会当成「查过了，没有」接着往下走。

        Args: name, arguments。
        """
        owner = self.owners.get(name)
        if owner is None:
            raise UnknownTool(f"没有这个工具：{name}")
        return await owner.run(name, arguments)

    def specs_of(self, provider: str) -> tuple[ToolSpec, ...]:
        """只要某一路的规格。

        ⚠ 给「逐轮才知道的那几个」用：它们不在静态的 `TOOL_SPECS` 里，
        要单独交给 `intent.specs_for` 的 `extra`。

        Args: provider（那一路在注册表里的名字）。
        """
        return tuple(
            spec
            for spec in self.specs
            if self.owners[spec.name].name == provider
        )


def registry_of(providers: tuple[ToolProvider, ...]) -> ToolRegistry:
    """把几路来源装成一个注册表，顺路查重名。

    Args: providers（顺序即规格在提示词里的先后）。
    """
    specs: list[ToolSpec] = []
    owners: dict[str, ToolProvider] = {}
    for provider in providers:
        for spec in provider.specs():
            if spec.name in owners:
                raise DuplicateTool(
                    f"{spec.name} 同时来自 {owners[spec.name].name} "
                    f"与 {provider.name}"
                )
            owners[spec.name] = provider
            specs.append(spec)
    return ToolRegistry(providers=providers, specs=tuple(specs), owners=owners)


def build_registry(
    platform: PlatformClient | None = None,
    headers: dict[str, str] | None = None,
    mcp: McpCatalog | None = None,
    write_allowed: frozenset[str] = frozenset(),
) -> ToolRegistry:
    """这套部署的工具注册表。

    ⚠ 顺序是契约：服务端那一路在前，客户端那一路在后。它决定工具在提示词里的
    先后，而先后影响模型的第一反应（`intent/select.py` 有一条闸守着原序）。

    ⚠ **MCP 那一路排在最末尾**，这不是审美。它的规格逐轮可变（某一路连不上时
    它的工具这一轮就不在），排在前面的话，一路 MCP 抖一下会让后面所有内建工具的
    声明整体位移——而工具声明属于前缀缓存唯一能命中的那一段（ADR-0025 的 B 层）。
    放在最末尾，抖动只影响它自己那一截。

    Args: platform（上游业务面；只取规格时不用给）, headers（这一次要转发的
        身份头）, mcp（外部工具目录；不给即这一路缺席）, write_allowed（许下发的
        写操作规范名）。
    """
    providers: list[ToolProvider] = [
        ServerTools(platform=platform, headers=dict(headers or {})),
        ClientTools(),
    ]
    if mcp is not None and mcp.servers:
        providers.append(McpTools(catalog=mcp, write_allowed=write_allowed))
    return registry_of(tuple(providers))


def all_specs() -> tuple[ToolSpec, ...]:
    """全部工具的规格，与执行用的那一份**同源**。

    ⚠ 不带上游造一个注册表来取：规格不依赖请求上下文，依赖了的话这一份静态清单
    与实际下发的那一份就会漂开，而两边都不报错。这条由契约测试守。
    """
    return build_registry().specs
