"""语音上游关闭被取消时仍须释放 TCP 连接。"""

import asyncio

import pytest
from unit.funasr_fakes import BINARY, FakeFunAsr
from websockets.asyncio.client import ClientConnection, connect

from knowledge_server.apps.speech.errors import AsrUnavailable
from knowledge_server.apps.speech.services import funasr
from knowledge_server.apps.speech.services.funasr import FunAsrLeg


async def test_cancelled_close_aborts_the_upstream_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entered_close = asyncio.Event()

    async def blocked_close() -> None:
        entered_close.set()
        await asyncio.Future[None]()

    async with (
        FakeFunAsr().serving() as url,
        connect(url, subprotocols=[BINARY]) as connection,
    ):
        leg = FunAsrLeg(connection)
        with monkeypatch.context() as patch:
            patch.setattr(connection, "close", blocked_close)
            closing = asyncio.create_task(leg.aclose())
            await entered_close.wait()
            closing.cancel()
            with pytest.raises(asyncio.CancelledError):
                await closing
            is_closing = connection.transport.is_closing()
    assert is_closing, "取消关闭操作后，上游 TCP 仍然处于打开状态"


@pytest.mark.parametrize("is_cancelled", [False, True])
async def test_failed_init_releases_the_connected_transport(
    monkeypatch: pytest.MonkeyPatch, is_cancelled: bool
) -> None:
    failure = (
        asyncio.CancelledError()
        if is_cancelled
        else AsrUnavailable("init failed")
    )

    async def failed_send(_leg: FunAsrLeg, _text: str) -> None:
        raise failure

    async with (
        FakeFunAsr().serving() as url,
        connect(url, subprotocols=[BINARY]) as connection,
    ):

        async def connected(
            *_args: object, **_kwargs: object
        ) -> ClientConnection:
            return connection

        with monkeypatch.context() as patch:
            patch.setattr(funasr, "connect", connected)
            patch.setattr(FunAsrLeg, "send_text", failed_send)
            with pytest.raises(type(failure)):
                await funasr.open_leg(
                    funasr.FunAsrConfig(url=url), wav_name="init"
                )
            is_closing = connection.transport.is_closing()
    assert is_closing, "初始化失败后，上游 TCP 仍然处于打开状态"
