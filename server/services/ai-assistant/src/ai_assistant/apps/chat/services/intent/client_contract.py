"""按页面声明协商同名读工具的分页契约。"""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING, Final

from langchain_core.messages import AIMessage

from llmcore.tools.shapes import ToolSpec, object_schema, string_schema
from llmcore.turn.types import TurnOutcome

if TYPE_CHECKING:
    from collections.abc import Sequence

    from langchain_core.messages import BaseMessage

PAGED_VALUES: Final[str] = "capability.dashboard.read_values.v2"
DEFAULT_PAGE_SIZE: Final[int] = 20


def supports_paging(name: str, reported: Sequence[str] | None) -> bool:
    tools = reported or ()
    if name == "report.read_draft":
        return "report.read_content" in tools
    return name == "dashboard.read_values" and (
        PAGED_VALUES in tools or "dashboard.list_nodes" in tools
    )


def for_page(spec: ToolSpec, reported: Sequence[str] | None) -> ToolSpec:
    """按浏览器能力选择声明，旧页只收到它支持的入参。Args: spec, reported。"""
    if supports_paging(spec.name, reported):
        return spec
    if spec.name == "dashboard.read_values":
        return replace(
            spec,
            parameters=object_schema(
                {"node_id": string_schema("画布节点 id；省略时读取当前工作面")},
                [],
            ),
            description="读取当前画布读数；is_truncated 表示当前结果不完整。",
        )
    if spec.name == "report.read_draft":
        return replace(
            spec,
            parameters=object_schema({}, []),
            description="读取报告草稿与提纲；is_truncated 表示提纲未读全。",
        )
    return spec


def with_window_defaults(
    outcome: TurnOutcome, reported: Sequence[str] | None
) -> TurnOutcome:
    """将分页默认值同步到待办和调用记录。Args: outcome, reported。"""
    defaults = {
        call.call_id: {**call.arguments, "limit": DEFAULT_PAGE_SIZE}
        for call in outcome.pending
        if supports_paging(call.name, reported)
        and "limit" not in call.arguments
    }
    if not defaults:
        return outcome
    pending = tuple(
        (
            replace(call, arguments=defaults[call.call_id])
            if call.call_id in defaults
            else call
        )
        for call in outcome.pending
    )
    messages: list[BaseMessage] = []
    for message in outcome.messages:
        actual = message
        if isinstance(message, AIMessage) and any(
            call.get("id") in defaults for call in message.tool_calls
        ):
            calls = [
                (
                    {**call, "args": defaults[identifier]}
                    if (identifier := call.get("id")) is not None
                    and identifier in defaults
                    else call
                )
                for call in message.tool_calls
            ]
            actual = message.model_copy(update={"tool_calls": calls})
        messages.append(actual)
    return replace(outcome, messages=messages, pending=pending)
