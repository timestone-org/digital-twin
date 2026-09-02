"""一批工具来源装成一个注册表，以及按名字分派。

⚠ 注册是**显式元组**，不靠 import 副作用（ADR-0029 决策四）：隐式注册会让
「接了哪几路」取决于 import 顺序，而顺序在测试里与生产里可以不同。

⚠ 注册表**按请求造**：有的 provider 握着这一次要转发的身份头，做成进程级单例
会让两个用户互相借用对方的身份。

⚠ 规格在**造注册表的那一刻取一次快照**，之后分派不再问 provider：有的来源
（如外部 MCP）的 `specs()` 要走网络，每次分派都问一遍，一个回合几十次工具调用
就是几十次多余的往返。

装了哪几路由各家自己拼（`ai_assistant` 与 `knowledge_server` 各有一份 build）。
"""

from dataclasses import dataclass
from typing import Any

from llmcore.tools.ports import ToolProvider, UnknownTool
from llmcore.tools.shapes import ToolSpec


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
