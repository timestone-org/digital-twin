"""模型回放把已结束回合的编号与本轮引用账本隔离。"""

from collections.abc import Sequence
from dataclasses import replace
from typing import cast

from langchain_core.messages import AIMessage, ToolMessage

from knowledge_server.apps.chat.models import ChatMessage
from knowledge_server.apps.chat.services.markers import (
    historical_text,
    numbers_in,
)
from knowledge_server.apps.chat.services.tools.knowledge import (
    READ_CHUNK,
    SEARCH,
)
from llmcore.memory import HistoryRow, Summary, history

_HISTORICAL_RECEIPT = (
    "历史资料回执。要引用旧来源，请重新检索或按历史答复注明的块 ID 读取。"
)
_SOURCE_TOOLS = frozenset({SEARCH, READ_CHUNK})


def model_history(
    messages: Sequence[ChatMessage], *, is_resuming: bool
) -> list[HistoryRow]:
    """保留当前续跑回合的原文，界面用的持久记录不参与改写。"""
    current_start = (
        next(
            (row.seq for row in reversed(messages) if row.role == "user"),
            None,
        )
        if is_resuming
        else None
    )
    calls: dict[str, str] = {}
    result: list[HistoryRow] = []
    for message in messages:
        row = HistoryRow(
            role=message.role,
            seq=message.seq,
            content_json=message.content_json,
        )
        if current_start is None or row.seq < current_start:
            row = _historical_row(row, message, calls)
        result.append(row)
    return result


def _historical_row(
    row: HistoryRow, message: ChatMessage, calls: dict[str, str]
) -> HistoryRow:
    replayed = history.to_message(row)
    if isinstance(replayed, AIMessage):
        calls.update(
            (one["id"], one["name"])
            for one in replayed.tool_calls
            if one["id"] is not None
        )
        text = historical_text(str(replayed.content), _references(message))
    elif (
        isinstance(replayed, ToolMessage)
        and calls.pop(replayed.tool_call_id, "") in _SOURCE_TOOLS
    ):
        text = _HISTORICAL_RECEIPT
    else:
        return row
    return replace(row, content_json={**row.content_json, "text": text})


def _references(message: ChatMessage) -> dict[int, str]:
    sources: dict[int, str] = {}
    for item in message.citations_json or []:
        if not isinstance(item, dict):
            continue
        reference = cast("dict[str, object]", item)
        marker = reference.get("marker")
        chunk_id = reference.get("chunk_id")
        if isinstance(marker, str) and isinstance(chunk_id, str):
            for number in numbers_in(marker):
                sources[number] = chunk_id
    return sources


def model_summary(summary: Summary | None) -> Summary | None:
    """历史摘要可以保留结论，其中的圆圈编号不属于当前回合。"""
    if summary is None:
        return None
    return replace(summary, text=historical_text(summary.text, {}))
