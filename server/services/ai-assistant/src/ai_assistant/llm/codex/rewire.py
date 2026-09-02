"""订阅账号那一路的线形改写，装成 `llmcore.guard.Rewire` 的形状。

⚠ 只有这一路要改：它的端点不认工具名里的点号（`wire_names` 文件头）。
外壳本身在 llmcore、两个服务共用，所以特例只能以钩子的形式从这里注进去。
"""

from collections.abc import Sequence
from dataclasses import dataclass

from langchain_core.messages import AIMessage, BaseMessage

from ai_assistant.llm.codex import wire_names
from ai_assistant.llm.ports import CODEX_PROFILE, ModelChoice
from llmcore.guard import ToolDecl


@dataclass(frozen=True)
class CodexRewire:
    """出去换掉点号，回来换回来。"""

    def applies(self, choice: ModelChoice) -> bool:
        """只对订阅账号那一档生效。

        Args: choice。
        """
        return choice.profile == CODEX_PROFILE

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
