"""开流之后的失败必须落成 `error` 帧，不能直接断流。

守的是「浏览器只看到流断了」：响应头已经发出去，未知异常一路抛到 ASGI 只会
掐断连接，界面上没有错误帧，也没有能和后端日志对上的 trace_id。
"""

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest

from ai_assistant.apps.chat.api import advance as advance_api
from ai_assistant.apps.chat.schemas.advance import AdvanceIn
from lib.errors import ValidationFailed
from llmcore.turn.types import TurnDelta


async def _collect(stream: AsyncIterator[str]) -> list[str]:
    return [frame async for frame in stream]


def _crashing(error: Exception) -> Any:
    async def advance(*_args: object, **_kwargs: object) -> AsyncIterator[Any]:
        yield TurnDelta(channel="text", text="半句")
        raise error

    return advance


def _last_event(frames: list[str]) -> tuple[str, dict[str, Any]]:
    lines = frames[-1].strip().splitlines()
    event = next(line for line in lines if line.startswith("event:"))
    data = next(line for line in lines if line.startswith("data:"))
    return event.split(":", 1)[1].strip(), json.loads(data.split(":", 1)[1])


async def test_an_unexpected_error_ends_with_an_error_frame(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        advance_api.advance_service, "advance", _crashing(RuntimeError("坏"))
    )
    frames = await _collect(
        advance_api._frames(  # pyright: ignore[reportPrivateUsage]
            object(),  # pyright: ignore[reportArgumentType]
            uuid.uuid4(),
            advance_api._to_input(  # pyright: ignore[reportPrivateUsage]
                AdvanceIn(surface_kind="dashboard-editor", user_text="你好"), []
            ),
        )
    )
    event, data = _last_event(frames)
    assert event == "error"
    assert data["code"] == 50000
    assert "trace_id" in data
    assert "坏" not in data["message"]


async def test_an_app_error_keeps_its_own_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        advance_api.advance_service,
        "advance",
        _crashing(ValidationFailed("不收")),
    )
    frames = await _collect(
        advance_api._frames(  # pyright: ignore[reportPrivateUsage]
            object(),  # pyright: ignore[reportArgumentType]
            uuid.uuid4(),
            advance_api._to_input(  # pyright: ignore[reportPrivateUsage]
                AdvanceIn(surface_kind="dashboard-editor", user_text="你好"), []
            ),
        )
    )
    event, data = _last_event(frames)
    assert event == "error"
    assert data["code"] == ValidationFailed.code
