"""消息在「库里的一行」与「模型认的一条」之间来回。

⚠ 存的是**结构**不是提示词文本：把整段提示词拼好再存，将来改了提示词的写法，
历史会话会用两套口径重放，而模型对同一段对话的理解会跟着变。系统提示词
每次现拼（`prompt.build_system_prompt`），库里一条都不存。

⚠ 工具消息必须带回 `tool_call_id`。丢了它，模型看到的是「有人回了句话，
但不知道回的是哪次调用」——端点那一侧多半直接判请求不合法。
"""

from typing import Any, cast

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)
from langchain_core.messages.tool import ToolCall

from ai_assistant.apps.chat.models import ChatMessage

_USER = "user"
_ASSISTANT = "assistant"
_TOOL = "tool"


def to_content(message: BaseMessage) -> tuple[str, dict[str, Any]]:
    """把一条模型消息摊成 `(role, content_json)`。

    Args: message。
    """
    if isinstance(message, AIMessage):
        return _ASSISTANT, {
            "text": _text_of(message),
            "tool_calls": list(message.tool_calls),
        }
    if isinstance(message, ToolMessage):
        return _TOOL, {
            "tool_call_id": message.tool_call_id,
            "text": _text_of(message),
        }
    return _USER, {"text": _text_of(message)}


def to_message(row: ChatMessage) -> BaseMessage:
    """把库里的一行还原成模型认的一条。

    Args: row。
    """
    body = row.content_json
    text = str(body.get("text") or "")
    if row.role == _ASSISTANT:
        return AIMessage(content=text, tool_calls=_calls_of(body))
    if row.role == _TOOL:
        return ToolMessage(
            content=text, tool_call_id=str(body.get("tool_call_id") or "")
        )
    return HumanMessage(content=text)


def replay(rows: list[ChatMessage]) -> list[BaseMessage]:
    """把一段历史按 `seq` 还原成模型认的消息列表。

    Args: rows。
    """
    return [to_message(row) for row in sorted(rows, key=lambda one: one.seq)]


def _text_of(message: BaseMessage) -> str:
    content = message.content
    return content if isinstance(content, str) else ""


def _calls_of(body: dict[str, Any]) -> list[ToolCall]:
    """从落库的载荷里还原工具调用。

    ⚠ 收窄一次而不是原样 `list(...)`：JSONB 出来的是 `Any`，直接喂给
    `AIMessage` 会让整条消息的类型退化成未知，而那会一路传染到编排层。

    Args: body。
    """
    calls = body.get("tool_calls")
    if not isinstance(calls, list):
        return []
    return [cast("ToolCall", item) for item in cast("list[object]", calls)]
