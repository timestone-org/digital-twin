"""WS 凭据期限必须独立于客户端入站帧推进。"""

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import cast

from fastapi import WebSocket
from realtime_hub.apps.channel.api.ws import _pump
from realtime_hub.apps.channel.services import Connection, ConnectionRegistry
from realtime_hub.apps.channel.services.session import CLOSE_TOKEN_EXPIRED
from realtime_hub.container import Container

from lib.testing import FrozenClock

NOW = datetime(2026, 9, 7, 8, 0, tzinfo=UTC)
OLD_EXPIRY = NOW + timedelta(seconds=120)
NEW_EXPIRY = NOW + timedelta(seconds=600)


class AdvancingDeadlineWaiter:
    """把等待直接推进到截止点，但先让凭据更新获得一次调度。"""

    def __init__(self, clock: FrozenClock) -> None:
        self._clock = clock

    async def __call__(self, changed: asyncio.Event, timeout_s: float) -> None:
        await asyncio.sleep(0)
        if not changed.is_set():
            self._clock.advance(timeout_s)


class RecordingSocket:
    """可保持静默，也可在首次换票提醒后送入一帧 reauth。"""

    def __init__(
        self, clock: FrozenClock, warning_sent: asyncio.Event, token: str | None
    ) -> None:
        self._clock = clock
        self._warning_sent = warning_sent
        self._token = token
        self._delivered = False
        self.closed: list[tuple[int, datetime]] = []

    async def receive_text(self) -> str:
        if self._token is not None and not self._delivered:
            await self._warning_sent.wait()
            self._delivered = True
            return json.dumps({"action": "reauth", "token": self._token})
        await asyncio.Event().wait()
        raise AssertionError("静默连接不会收到入站帧")

    async def close(self, code: int) -> None:
        self.closed.append((code, self._clock()))


class RefreshingSession:
    """收到 reauth 后把连接期限推进到新令牌的期限。"""

    def __init__(self, expires_at: datetime | None) -> None:
        self._expires_at = expires_at
        self.reauth_count = 0

    async def dispatch(
        self, connection: Connection, message: dict[str, object]
    ) -> None:
        if message.get("action") != "reauth" or self._expires_at is None:
            return
        self.reauth_count += 1
        connection.expires_at = self._expires_at
        connection.credential_changed.set()


async def _run_deadline(
    *, refreshed_expires_at: datetime | None
) -> tuple[list[dict[str, object]], RecordingSocket, RefreshingSession]:
    clock = FrozenClock(NOW)
    warning_sent = asyncio.Event()
    sent: list[dict[str, object]] = []

    async def send(message: dict[str, object]) -> None:
        sent.append(message)
        if message.get("event") == "reauth_required":
            warning_sent.set()

    async def send_frame(_frame: str) -> None:
        return None

    connection = Connection(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        codes=frozenset({"opcua:view"}),
        expires_at=OLD_EXPIRY,
        checked_at=NOW,
        send=send,
        send_frame=send_frame,
    )
    connections = ConnectionRegistry()
    await connections.add(connection)
    session = RefreshingSession(refreshed_expires_at)
    container = cast(
        "Container",
        type(
            "FakeContainer",
            (),
            {"connections": connections, "session": session},
        )(),
    )
    socket = RecordingSocket(
        clock,
        warning_sent,
        "renewed-access" if refreshed_expires_at is not None else None,
    )

    await _pump(
        cast("WebSocket", socket),
        container,
        connection_id=connection.id,
        clock=clock,
        deadline_waiter=AdvancingDeadlineWaiter(clock),
    )
    return sent, socket, session


async def test_silent_connection_gets_warning_then_expiry_close() -> None:
    sent, socket, _session = await _run_deadline(refreshed_expires_at=None)

    assert sent == [{"type": "system", "event": "reauth_required"}]
    assert socket.closed == [(CLOSE_TOKEN_EXPIRED, OLD_EXPIRY)]


async def test_reauth_reschedules_close_past_the_old_expiry() -> None:
    sent, socket, session = await _run_deadline(refreshed_expires_at=NEW_EXPIRY)

    assert session.reauth_count == 1
    assert len(sent) == 2
    assert socket.closed == [(CLOSE_TOKEN_EXPIRED, NEW_EXPIRY)]
