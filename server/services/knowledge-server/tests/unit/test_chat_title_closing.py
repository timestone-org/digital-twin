"""首轮自动标题必须在终止帧前送达，工具待续也要命名。"""

import uuid
from unittest.mock import AsyncMock, Mock

import pytest

from knowledge_server.apps.chat.services import advance_service as svc
from knowledge_server.apps.chat.services import title_service
from llmcore.turn import ClientToolCall, TurnOutcome


@pytest.mark.parametrize("waiting", [False, True])
async def test_first_exchange_names_session_before_terminal_event(
    monkeypatch: pytest.MonkeyPatch, waiting: bool
) -> None:
    named = title_service.SessionTitled("余热回收水箱温度", 2)
    autotitle = AsyncMock(return_value=named)
    monkeypatch.setattr(title_service, "autotitle", autotitle)
    deps = svc.AdvanceDeps(
        sessions=Mock(), model=Mock(), tools=Mock(), summarizer=Mock()
    )
    outcome = TurnOutcome(reply="已打开卡片")
    if waiting:
        outcome = TurnOutcome(
            pending=(
                ClientToolCall(
                    call_id="search",
                    name="collect.search_points",
                    arguments={"query": "余热回收水箱温度"},
                ),
            ),
        )
    events = [
        item
        async for item in svc._closing(
            deps,
            uuid.uuid4(),
            svc.AdvanceInput(user_text="查看余热回收水箱温度"),
            [],
            outcome,
        )
    ]
    assert events == [named, outcome]
    assert autotitle.await_args is not None
    assert autotitle.await_args.args[3][0] == "查看余热回收水箱温度"


async def test_tool_receipts_do_not_generate_a_second_title(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    autotitle = AsyncMock()
    monkeypatch.setattr(title_service, "autotitle", autotitle)
    deps = svc.AdvanceDeps(
        sessions=Mock(), model=Mock(), tools=Mock(), summarizer=Mock()
    )
    outcome = TurnOutcome(reply="卡片已打开")
    events = [
        item
        async for item in svc._closing(
            deps,
            uuid.uuid4(),
            svc.AdvanceInput(
                tool_results=[svc.ClientToolResult(call_id="open", output={})]
            ),
            [],
            outcome,
        )
    ]
    assert events == [outcome]
    autotitle.assert_not_awaited()
