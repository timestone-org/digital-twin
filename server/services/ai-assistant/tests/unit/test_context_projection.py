"""助手真实推进入口保护用户要求，并限制模型看到的累计上下文。"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.errors import ChatContextTooLarge
from ai_assistant.apps.chat.services import advance_service
from ai_assistant.apps.chat.services.advance_service import (
    AdvanceDeps,
    AdvanceInput,
)
from ai_assistant.apps.chat.services.memory.context import (
    IMAGE_CALL_ID,
    ContextProjection,
    input_size,
    marked,
)
from ai_assistant.llm import GuardedModel, ModelChoice
from lib.resilience import CircuitBreaker
from llmcore.memory import HistoryRow, summarize
from llmcore.memory.history import sized
from llmcore.testing import ScriptedChat
from llmcore.tools.shapes import ToolSpec


@asynccontextmanager
async def _unused_sessions() -> AsyncIterator[AsyncSession]:
    async with AsyncSession() as session:
        yield session


async def _unused_tool(_name: str, _args: dict[str, Any]) -> object:
    raise AssertionError("本用例不执行业务写入")


def _large_history() -> list[HistoryRow]:
    rows: list[HistoryRow] = []
    for index in range(20):
        call_id = f"call-{index}"
        rows.extend(
            [
                HistoryRow(
                    role="assistant",
                    seq=index * 2,
                    content_json={
                        "text": "",
                        "tool_calls": [
                            {
                                "name": "points.detail",
                                "id": call_id,
                                "args": {"node_key": "source:point"},
                            }
                        ],
                    },
                ),
                HistoryRow(
                    role="tool",
                    seq=index * 2 + 1,
                    content_json={
                        "tool_call_id": call_id,
                        "text": "数据" * 10000,
                    },
                ),
            ]
        )
    return rows


async def test_advance_bounds_large_history_before_the_first_model_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = ScriptedChat(script=[AIMessage(content="核对完成")])

    async def source(_choice: ModelChoice) -> BaseChatModel:
        return model

    rows = _large_history()
    payload = AdvanceInput(
        surface_kind="twin-editor", user_text="核对选中设备，保持其它设备不变"
    )
    messages = advance_service.assemble(payload=payload, rows=rows, plan=None)

    async def opened(*_args: object) -> tuple[list[Any], ModelChoice]:
        return messages, ModelChoice()

    async def persist(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(advance_service, "_opened", opened)
    monkeypatch.setattr(advance_service, "_persist_turn", persist)
    deps = AdvanceDeps(
        sessions=_unused_sessions,
        model=GuardedModel(
            source=source, breaker=CircuitBreaker(name="context-test")
        ),
        server_tools=_unused_tool,
        summarizer=lambda _profile: summarize.NullSummarizer(),
    )
    events = [
        event
        async for event in advance_service.advance(
            deps, chat_session_id=uuid.uuid4(), payload=payload
        )
    ]
    assert events
    assert sum(sized(one) for one in model.seen[0]) < 90_000
    assert any(one.content == payload.user_text for one in model.seen[0])


def test_projection_keeps_request_image_and_matching_receipt_atomically() -> (
    None
):
    request = HumanMessage(content="只检查这台泵，不修改其它设备")
    call = AIMessage(
        content="",
        tool_calls=[{"name": "dashboard.capture", "id": "shot", "args": {}}],
    )
    receipt = ToolMessage(content="图片已取得", tool_call_id="shot")
    image = HumanMessage(
        content=[
            {
                "type": "image_url",
                "image_url": {"url": "data:image/png;base64,AA=="},
            }
        ],
        additional_kwargs={IMAGE_CALL_ID: "shot"},
    )
    messages: list[BaseMessage] = [
        *marked([SystemMessage(content="规则")], "prefix"),
        request,
        AIMessage(content="旧结果" * 10000),
        call,
        receipt,
        image,
    ]
    original = [one.model_dump() for one in messages]
    projection = ContextProjection(
        13_000, 100, (), messages, lambda: [HumanMessage(content="最新状态")]
    )
    visible = projection(messages)
    assert request in visible
    assert call in visible
    assert receipt in visible
    assert any(one.content == image.content for one in visible)
    assert all(IMAGE_CALL_ID not in one.additional_kwargs for one in visible)
    assert input_size(visible) + 100 < 13_000
    assert [one.model_dump() for one in messages] == original


def test_required_input_is_never_shortened_to_fit() -> None:
    messages = [
        *marked([SystemMessage(content="规则")], "prefix"),
        HumanMessage(content="不要遗漏" * 1000),
    ]
    projection = ContextProjection(1000, 500, (), messages, list)
    with pytest.raises(ChatContextTooLarge, match="上下文预算"):
        projection(messages)


def test_projection_refreshes_state_without_repeating_the_previous_state() -> (
    None
):
    tail: list[BaseMessage] = [HumanMessage(content="计划：pending")]
    messages = [HumanMessage(content="继续任务"), *marked(tail, "state")]
    projection = ContextProjection(5000, 100, (), messages, lambda: tail)
    tail[:] = [HumanMessage(content="计划：done")]
    visible = projection(messages)
    assert visible[-1].content == "计划：done"
    assert all(one.content != "计划：pending" for one in visible)


async def test_full_tool_result_budget_allows_next_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = ScriptedChat(
        script=[
            AIMessage(
                content="", tool_calls=[{"name": "scan", "id": "c", "args": {}}]
            ),
            AIMessage(content="已核对"),
        ]
    )

    stored: list[object] = []
    deps = _budget_deps(monkeypatch, model, stored)
    events = [
        one
        async for one in advance_service.advance(
            deps,
            chat_session_id=uuid.uuid4(),
            payload=AdvanceInput(surface_kind="test", user_text="检查当前设备"),
        )
    ]
    assert events
    assert len(model.seen) == 2
    assert len(stored) == 1


def _budget_deps(
    monkeypatch: pytest.MonkeyPatch, model: ScriptedChat, stored: list[object]
) -> AdvanceDeps:
    async def source(_choice: ModelChoice) -> BaseChatModel:
        return model

    messages = [
        *marked([SystemMessage(content="规则")], "prefix"),
        HumanMessage(content="检查当前设备"),
    ]

    async def opened(*_args: object) -> tuple[list[BaseMessage], ModelChoice]:
        return messages, ModelChoice()

    async def run(_name: str, _args: dict[str, Any]) -> object:
        return "x" * 10_000

    async def persist(*args: object) -> None:
        stored.append(args)

    spec = ToolSpec(
        "scan", "读取", {"type": "object", "properties": {}}, "server"
    )
    monkeypatch.setattr(advance_service, "_opened", opened)
    monkeypatch.setattr(advance_service, "_persist_turn", persist)
    monkeypatch.setattr(
        advance_service.tool_select,
        "specs_for",
        lambda *_args, **_kwargs: (spec,),
    )
    return AdvanceDeps(
        sessions=_unused_sessions,
        model=GuardedModel(
            source=source, breaker=CircuitBreaker(name="budget-result")
        ),
        server_tools=run,
        summarizer=lambda _profile: summarize.NullSummarizer(),
        model_context_tokens=3000,
    )
