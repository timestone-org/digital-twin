"""层 5 执行与工具的扩展点：一批工具从哪来、怎么跑。

⚠ **规格与实现收在同一个对象上。** 今天它们分住两处（`TOOL_SPECS` 一份、
`server_tools._handlers()` 一份，技能清单里还有第三处名字），加一个工具要动
三处，而漏一处不报错——表现是「模型看得见、调一次失败一次」，与「这一页
没实现它」长得一模一样。

⚠ 客户端那一路的 `run` **必须抛**，不许静默成功：那些工具在服务端压根没有实现，
静默成功会让模型以为改好了、接着往下走，最后给用户一个「已完成」而画面纹丝不动
（ADR-0023）。
"""

from typing import Any, Protocol, runtime_checkable

from ai_assistant.apps.chat.services.tools.shapes import ToolSpec


class UnknownTool(LookupError):
    """这一路来源里没有这个工具名。"""


class RunsElsewhere(RuntimeError):
    """这个工具认得，但不在这一侧执行。

    ⚠ 与 `UnknownTool` 分开是刻意的，两者要做的事完全相反：认不出的名字是模型编
    出来的，该让它换一条路；而这一档说明**编排层把活派错了地方**——客户端工具本
    该随回合交给浏览器，走到服务端的分派表里就是编排出了错。混成一档的话，后者会
    被当成「模型又编了个工具名」而永远查不到。
    """


@runtime_checkable
class ToolProvider(Protocol):
    """一批工具的来源。加一路来源 = 加一个文件 + 注册表一行。"""

    name: str

    def specs(self) -> tuple[ToolSpec, ...]:
        """这一路提供哪些工具。

        ⚠ 每一轮现取而不是装配期定死：MCP 那一路的某个 server 连不上时，
        它的工具这一轮就不该出现在清单里（ADR-0031 决策五）。
        """
        ...

    async def run(self, name: str, arguments: dict[str, Any]) -> Any:
        """跑一个。认不出名字抛 `UnknownTool`。

        Args: name, arguments。
        """
        ...
