"""消息在「库里的一行」与「模型认的一条」之间来回。

⚠ 存的是**结构**不是提示词文本：把整段提示词拼好再存，将来改了提示词的写法，
历史会话会用两套口径重放，而模型对同一段对话的理解会跟着变。系统提示词
每次现拼（`prompt.build_system_prompt`），库里一条都不存。

⚠ 工具消息必须带回 `tool_call_id`。丢了它，模型看到的是「有人回了句话，
但不知道回的是哪次调用」——端点那一侧多半直接判请求不合法。

⚠ **图不落库**，落的是一句占位。一张截图是几兆字节的 base64，存进去之后这个
会话每重放一次就把它再喂给模型一遍，上下文与账单一起翻倍。图只活在截它的那
一轮（`services/vision.py`）。
"""

from math import ceil
from typing import Any, cast

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)
from langchain_core.messages.tool import ToolCall

from ai_assistant.apps.chat.models import ChatMessage
from ai_assistant.apps.chat.services.vision import PLACEHOLDER
from ai_assistant.settings import HISTORY_DROP_STEP

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


def window(
    rows: list[ChatMessage],
    limit: int,
    step: int = HISTORY_DROP_STEP,
) -> list[ChatMessage]:
    """取最近的一截历史，**脱落按台阶走**，且不许把工具调用与它的回应切开。

    ⚠ 裸的 `[-limit:]` 会让窗口每多一条消息就整体前移一格。端点的前缀缓存认的是
    逐字相同的前缀，于是会话一过 `limit`，历史区**每一轮**都对不上——一个跑了
    几十轮的会话从此再也吃不到缓存，而这件事没有任何运行期迹象。按台阶脱落之后
    起点每 `step` 条才动一次，窗口在 `limit - step` 与 `limit` 之间浮动。

    ⚠ 掐掉头部的孤儿工具消息：切点落在「带工具调用的助手消息」与它的工具回应
    之间时，窗口会以几条没有调用的工具回应开头，端点直接判请求不合法，报出来的
    400 与真实原因毫无关系。掐头是安全的——窗口保住的是尾部，助手消息在窗口里
    时它的回应一定也在。

    Args: rows, limit（高水位）, step（一次脱落几条）。
    """
    ordered = sorted(rows, key=lambda one: one.seq)
    overflow = max(0, len(ordered) - limit)
    # ⚠ 脱落量要兜底。台阶比高水位还大时（`limit` 小于 `step` 的那些调用），
    # 一个台阶就能把整段历史削光，而表现是模型突然什么都不记得了
    floor = max(limit - step, 1)
    drop = min(ceil(overflow / step) * step, max(0, len(ordered) - floor))
    recent = ordered[drop:]
    start = 0
    while start < len(recent) and recent[start].role == _TOOL:
        start += 1
    return recent[start:]


def _text_of(message: BaseMessage) -> str:
    """一条消息落库时留下的那段文字。

    ⚠ 多模态消息的 content 是一串块。这里把文字块留下、图片块换成占位——
    原样存的话，一次截图会在库里留下几兆字节，且每次重放都再喂一遍。

    Args: message。
    """
    content = message.content
    if isinstance(content, str):
        return content
    parts = [_part_text(one) for one in cast("list[object]", content)]
    return " ".join(one for one in parts if one)


def _part_text(part: object) -> str:
    """一个内容块摊成文字。

    Args: part。
    """
    if isinstance(part, str):
        return part
    if not isinstance(part, dict):
        return ""
    body = cast("dict[str, object]", part)
    if body.get("type") == "text":
        return str(body.get("text") or "")
    return PLACEHOLDER


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
