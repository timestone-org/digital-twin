"""跑 llmcore 用例要的几个假件。

⚠ 假件只答应**协议里写着的那部分**：多答应一点，用例就会在真实现给不出的
返回上变绿（本仓吃过这个亏）。
"""

from collections.abc import Sequence
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.tools import BaseTool

from llmcore.deltas import DeltaSink
from llmcore.ports import ModelChoice


def tool_call(
    name: str, arguments: dict[str, Any], call_id: str
) -> dict[str, Any]:
    """一条工具调用的线形，与 langchain 认的那份一致。"""
    return {"name": name, "args": arguments, "id": call_id, "type": "tool_call"}


class ScriptedResponder:
    """按剧本逐条回复的 `Responder`。剧本用完再问就报错。

    ⚠ 用完就报错而不是重复最后一条：重复会让「多转了一圈」这种缺陷静默通过，
    而那正是回合循环最容易出的错。
    """

    def __init__(self, replies: Sequence[AIMessage]) -> None:
        self._replies = list(replies)
        self.asked: list[list[BaseMessage]] = []
        self.tools_seen: list[int] = []

    async def respond(
        self,
        *,
        choice: ModelChoice,
        messages: list[BaseMessage],
        tools: Sequence[dict[str, Any] | BaseTool],
        on_delta: DeltaSink | None = None,
    ) -> AIMessage:
        """交出剧本里的下一条。"""
        del choice
        self.asked.append(list(messages))
        self.tools_seen.append(len(tools))
        if not self._replies:
            raise AssertionError("模型被多问了一次——剧本已经用完")
        reply = self._replies.pop(0)
        if on_delta is not None and isinstance(reply.content, str):
            on_delta("text", reply.content)
        return reply
