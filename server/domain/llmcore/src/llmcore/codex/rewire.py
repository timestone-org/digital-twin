"""订阅账号那一路的线形改写，装成 `llmcore.guard.Rewire` 的形状。

⚠ 只有这一路要改：它的端点不认工具名里的点号（`wire_names` 文件头）。外壳本身
在 `guard`、两个消费方共用，所以特例只能以钩子的形式注进去。

⚠ 「这一次是不是那一路」由消费方回答（`is_codex`），不是拿档位名与一个字面量
比：目录里配出来的每一路各是一个档位，档位名是 uuid（ADR-0040）。按字面量比的话
那几路一条都改写不到，而现象是「一带工具就 400」。
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from langchain_core.messages import AIMessage, BaseMessage

from llmcore.codex import wire_names
from llmcore.codex.wire_names import ToolDecl
from llmcore.ports import ModelChoice

# 问一个档位名是不是订阅账号那一路
IsCodex = Callable[[str], bool]


@dataclass(frozen=True)
class CodexRewire:
    """出去换掉点号，回来换回来。"""

    is_codex: IsCodex

    def applies(self, choice: ModelChoice) -> bool:
        """只对订阅账号那几路生效。

        Args: choice。
        """
        return self.is_codex(choice.profile)

    def outbound(
        self, tools: Sequence[ToolDecl], messages: list[BaseMessage]
    ) -> tuple[list[ToolDecl], list[BaseMessage]]:
        """出去之前把工具名与历史里的调用名都换成线形。

        Args: tools, messages。
        """
        return (
            wire_names.wired_tools(tools),
            wire_names.wired_messages(messages),
        )

    def inbound(self, reply: AIMessage) -> AIMessage:
        """回来之后把调用名换回注册表认的样子。

        Args: reply。
        """
        return wire_names.restored(reply)
