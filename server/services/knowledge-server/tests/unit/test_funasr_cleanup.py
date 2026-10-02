"""纯连接假件验证 FunASR 初始化与关闭的异常传播和资源释放。"""

import asyncio
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from websockets.asyncio.client import ClientConnection

from knowledge_server.apps.speech.errors import AsrUnavailable
from knowledge_server.apps.speech.services import funasr


def connection_fake() -> MagicMock:
    connection = MagicMock(spec=ClientConnection)
    connection.send = AsyncMock()
    connection.close = AsyncMock()
    connection.transport = MagicMock()
    return connection


async def test_normal_close_keeps_the_graceful_handshake() -> None:
    connection = connection_fake()
    leg = funasr.FunAsrLeg(cast("ClientConnection", connection))

    await leg.aclose()

    connection.close.assert_awaited_once()
    connection.transport.abort.assert_not_called()


@pytest.mark.parametrize(
    "is_cancelled", [False, True], ids=["failed", "cancelled"]
)
async def test_close_failure_aborts_and_preserves_the_exception(
    is_cancelled: bool,
) -> None:
    connection = connection_fake()
    failure = asyncio.CancelledError() if is_cancelled else OSError("关闭失败")
    connection.close.side_effect = failure
    leg = funasr.FunAsrLeg(cast("ClientConnection", connection))

    with pytest.raises(type(failure)) as caught:
        await leg.aclose()

    assert caught.value is failure
    connection.transport.abort.assert_called_once()


@pytest.mark.parametrize(
    "is_cancelled", [False, True], ids=["failed", "cancelled"]
)
async def test_init_failure_closes_the_connection_and_preserves_the_exception(
    monkeypatch: pytest.MonkeyPatch,
    is_cancelled: bool,
) -> None:
    connection = connection_fake()
    failure = (
        asyncio.CancelledError()
        if is_cancelled
        else AsrUnavailable("初始化失败")
    )
    connection.send.side_effect = failure
    monkeypatch.setattr(funasr, "connect", AsyncMock(return_value=connection))

    with pytest.raises(type(failure)) as caught:
        await funasr.open_leg(
            funasr.FunAsrConfig("ws://unused"), wav_name="测试"
        )

    assert caught.value is failure
    connection.close.assert_awaited_once()
    connection.transport.abort.assert_not_called()


@pytest.mark.parametrize(
    "is_cancelled", [False, True], ids=["init-failed", "init-cancelled"]
)
@pytest.mark.parametrize(
    "is_cleanup_cancelled",
    [False, True],
    ids=["close-failed", "close-cancelled"],
)
async def test_failed_cleanup_keeps_the_initialization_exception(
    monkeypatch: pytest.MonkeyPatch,
    is_cancelled: bool,
    is_cleanup_cancelled: bool,
) -> None:
    connection = connection_fake()
    failure = (
        asyncio.CancelledError()
        if is_cancelled
        else AsrUnavailable("初始化失败")
    )
    connection.send.side_effect = failure
    connection.close.side_effect = (
        asyncio.CancelledError()
        if is_cleanup_cancelled
        else OSError("关闭失败")
    )
    monkeypatch.setattr(funasr, "connect", AsyncMock(return_value=connection))

    with pytest.raises(type(failure)) as caught:
        await funasr.open_leg(
            funasr.FunAsrConfig("ws://unused"), wav_name="测试"
        )

    assert caught.value is failure
    connection.close.assert_awaited_once()
    connection.transport.abort.assert_called_once()
