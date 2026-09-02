"""失败的那一步要如实说出来，不许被读成「做完了」。

这条今天由两处保证：`planning/turn.py` 里服务端工具失败也回一条工具消息，
`memory/history.py` 的 `fillers` 给没等到回执的调用补一条失败回执。两处都在
**回合内**做，位置是对的——本检验器不重复它们，它是同一条口径在步骤这一层的
表达，给「一步做完之后再看一眼」那条路留的接口。
"""

from dataclasses import dataclass

from llmcore.reflection.ports import Finding
from llmcore.turn.types import TurnStep

# 步骤没带原因时的兜底话术。⚠ 不能编一句「执行失败」了事：模型据它决定要不要
# 重做这一步，而一句没有信息量的话会让它原样再试一次
_NO_REASON = "这一步失败了，但没有带回失败原因"


@dataclass(frozen=True)
class ToolFailureVerifier:
    """一步失败了就如实报出来。"""

    @property
    def name(self) -> str:
        """这一种检验在注册表里的名字。"""
        return "tool-failure"

    def applies(self, step: TurnStep) -> bool:
        """只管失败的那些。

        ⚠ `awaiting_client` 不是失败：那一步正等浏览器，判成失败会让模型
        以为客户端工具坏了，然后换一条路去做本来正在做的事。

        Args: step。
        """
        return step.state == "failed"

    async def check(self, step: TurnStep) -> Finding:
        """把失败原因原样交出去。

        Args: step。
        """
        return Finding(verdict="failed", message=step.error or _NO_REASON)
