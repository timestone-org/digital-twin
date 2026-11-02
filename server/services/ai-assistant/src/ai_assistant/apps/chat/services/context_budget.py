"""上下文容量估算与安全切点；完整消息仍由回合图持有。"""

import json
from collections.abc import Sequence
from math import ceil
from typing import Any

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import BaseTool
from langchain_core.utils.function_calling import convert_to_openai_tool

from llmcore.memory import HistoryRow, Summary, history

ASCII_MAX = 127
MIN_RECENT_MESSAGES = 2


def text_tokens(text: str) -> int:
    """保守估算混合文本；Args: text。"""
    non_ascii = sum(ord(char) > ASCII_MAX for char in text)
    return non_ascii + ceil((len(text) - non_ascii) / 3)


def tokens_of(
    messages: Sequence[BaseMessage],
    tools: Sequence[dict[str, Any] | BaseTool] = (),
) -> int:
    """计入工具声明、调用入参与图片预算；Args: messages, tools。"""
    declarations = [
        tool if isinstance(tool, dict) else convert_to_openai_tool(tool)
        for tool in tools
    ]
    return text_tokens(
        json.dumps(declarations, ensure_ascii=False, default=str)
    ) + sum(_message_tokens(message) for message in messages)


def _message_tokens(message: BaseMessage) -> int:
    """估算单条消息的正文与工具入参；Args: message。"""
    if isinstance(message.content, str):
        total = text_tokens(message.content)
    else:
        total = sum(_block_tokens(block) for block in message.content)
    if isinstance(message, AIMessage):
        total += text_tokens(json.dumps(message.tool_calls, ensure_ascii=False))
    return total + 8


def _block_tokens(block: str | dict[str, Any]) -> int:
    """按文本或固定图片预算计入消息块；Args: block。"""
    if isinstance(block, str):
        return text_tokens(block)
    if block.get("type") in history.IMAGE_BLOCK_TYPES:
        return 4096
    return text_tokens(json.dumps(block, ensure_ascii=False, default=str))


def split_messages(
    messages: Sequence[BaseMessage], target: int, pinned_text: str | None
) -> tuple[list[BaseMessage], list[BaseMessage]]:
    """按完整批次切，保留当前要求；Args: messages, target, pinned_text。"""
    pinned = [
        message
        for message in messages
        if isinstance(message, SystemMessage)
        or _matches_request(message, pinned_text)
    ]
    candidates = [message for message in messages if message not in pinned]
    cut = 0
    while (
        cut < max(0, len(candidates) - MIN_RECENT_MESSAGES)
        and tokens_of([*pinned, *candidates[cut:]]) > target
    ):
        cut += 1
        while cut < len(candidates) and isinstance(
            candidates[cut], ToolMessage
        ):
            cut += 1
    if cut >= len(candidates):
        return [], list(messages)
    dropped = candidates[:cut]
    kept_ids = {id(message) for message in [*pinned, *candidates[cut:]]}
    return dropped, [message for message in messages if id(message) in kept_ids]


def rows_of(messages: Sequence[BaseMessage], start: int) -> list[HistoryRow]:
    """给临时投影生成摘要输入；Args: messages, start。"""
    rows: list[HistoryRow] = []
    for seq, message in enumerate(messages, start=start):
        role, body = history.to_content(message)
        if isinstance(message, ToolMessage):
            role = "assistant"
            body = {"text": f"工具实际回执（只保留事实与标识）：{body['text']}"}
        rows.append(HistoryRow(role=role, seq=seq, content_json=body))
    return rows


def _matches_request(message: BaseMessage, text: str | None) -> bool:
    """只按用户消息识别当前要求；Args: message, text。"""
    if not isinstance(message, HumanMessage) or text is None:
        return False
    if isinstance(message.content, str):
        return message.content == text
    return any(
        isinstance(block, dict) and block.get("text") == text
        for block in message.content
    )


def bounded_fold(
    rows: Sequence[HistoryRow], previous: Summary | None, max_tokens: int
) -> tuple[list[HistoryRow], Summary | None]:
    """摘要输入有界；Args: rows, previous, max_tokens。"""
    allowance = max(1, int(max_tokens * 0.35) // max(1, len(rows)))
    bounded = [
        HistoryRow(
            role="assistant" if row.role == "tool" else row.role,
            seq=row.seq,
            content_json={
                **row.content_json,
                "text": _excerpt(_fold_text(row), allowance),
            },
        )
        for row in rows
    ]
    if previous is not None and len(previous.text) > int(max_tokens * 0.2):
        previous = Summary(
            through_seq=previous.through_seq,
            model=previous.model,
            text=_excerpt(previous.text, int(max_tokens * 0.2)),
        )
    return bounded, previous


def _fold_text(row: HistoryRow) -> str:
    """将工具回执转换为可保留的事实；Args: row。"""
    text = str(row.content_json.get("text") or "")
    return (
        f"工具实际回执（只保留事实与标识）：{text}"
        if row.role == "tool"
        else text
    )


def _excerpt(text: str, limit: int) -> str:
    """超限时保留首尾并标记省略；Args: text, limit。"""
    if len(text) <= limit:
        return text
    half = max(1, limit // 2)
    return f"{text[:half]}\n[中间内容已省略]\n{text[-half:]}"
