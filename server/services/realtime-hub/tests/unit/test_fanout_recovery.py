"""Redis 订阅中断后的投递恢复、全量重同步与关停。"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from realtime_hub.apps.channel.services import (
    Connection,
    ConnectionRegistry,
    FanoutListener,
    fanout,
)

from lib.cache import PubSub
from lib.errors import DependencyUnavailable


class RecoveringPubSub(PubSub):
    def __init__(self) -> None:
        self.messages: asyncio.Queue[dict[str, object] | Exception] = (
            asyncio.Queue()
        )
        self.failed = asyncio.Event()
        self.finished = asyncio.Event()

    async def listen(
        self, channels: Sequence[str]
    ) -> AsyncIterator[tuple[str, dict[str, object]]]:
        assert channels == ["ch"]
        try:
            while True:
                message = await self.messages.get()
                if isinstance(message, Exception):
                    self.failed.set()
                    raise message
                yield "ch", message
        finally:
            self.finished.set()


@pytest.fixture
def fast_reconnect(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fanout, "RECONNECT_BASE_S", 0.001)
    monkeypatch.setattr(fanout, "RECONNECT_MAX_S", 0.002)


def make_connection(
    received: list[dict[str, object]], arrived: asyncio.Event
) -> Connection:
    async def send(message: dict[str, object]) -> None:
        received.append(message)

    async def send_frame(frame: str) -> None:
        received.append(json.loads(frame))
        arrived.set()

    return Connection(
        id=uuid.UUID(int=1),
        user_id=uuid.UUID(int=2),
        codes=frozenset(),
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        checked_at=datetime(2026, 1, 1, tzinfo=UTC),
        send=send,
        send_frame=send_frame,
    )


@pytest.mark.usefixtures("fast_reconnect")
@pytest.mark.parametrize("is_midstream", [False, True])
async def test_listener_delivers_after_redis_subscription_recovers(
    is_midstream: bool,
) -> None:
    pubsub = RecoveringPubSub()
    connections = ConnectionRegistry()
    received: list[dict[str, object]] = []
    arrived = asyncio.Event()
    connection = make_connection(received, arrived)
    await connections.add(connection)
    await connections.bind(connection.id, "test:1")
    listener = FanoutListener(
        pubsub=pubsub, connections=connections, channel="ch"
    )
    await listener.start()
    try:
        async with asyncio.timeout(2):
            if is_midstream:
                pubsub.messages.put_nowait({"topic": "test:1", "seq": 1})
                await arrived.wait()
                arrived.clear()
                received.clear()
            for _ in range(3):
                pubsub.messages.put_nowait(DependencyUnavailable("离线"))
            pubsub.messages.put_nowait({"topic": "test:1", "seq": 2})
            await arrived.wait()
            assert received == [{"topic": "test:1", "seq": 2}]
    finally:
        await listener.stop()
    assert pubsub.finished.is_set()


@pytest.mark.usefixtures("fast_reconnect")
async def test_recovery_reconnects_clients_that_missed_initial_values() -> None:
    pubsub = RecoveringPubSub()
    connections = ConnectionRegistry()
    arrived = asyncio.Event()
    connection = make_connection([], arrived)
    close = AsyncMock(side_effect=[ConnectionResetError(), None])
    connection.close = close
    await connections.add(connection)
    await connections.bind(connection.id, "test:1")
    pubsub.messages.put_nowait(DependencyUnavailable("离线"))
    pubsub.messages.put_nowait({"topic": "test:1", "seq": 2})
    listener = FanoutListener(
        pubsub=pubsub, connections=connections, channel="ch"
    )
    await listener.start()
    try:
        async with asyncio.timeout(2):
            await arrived.wait()
        assert close.await_args_list == [((1013,),), ((1013,),)]
    finally:
        await listener.stop()


async def test_stopping_during_backoff_does_not_reconnect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(fanout, "RECONNECT_BASE_S", 60)
    pubsub = RecoveringPubSub()
    pubsub.messages.put_nowait(DependencyUnavailable("离线"))
    listener = FanoutListener(
        pubsub=pubsub, connections=ConnectionRegistry(), channel="ch"
    )
    await listener.start()
    async with asyncio.timeout(1):
        await pubsub.failed.wait()
        await listener.stop()
    assert pubsub.finished.is_set()
