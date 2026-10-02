"""取消 WebSocket 时，真实订阅行必须在端点返回前清理完。"""

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import cast

import pytest
from anyio import CancelScope
from fastapi import FastAPI, WebSocket
from realtime_hub.apps.channel.api.ws import _serve
from realtime_hub.apps.channel.services import Handshake
from realtime_hub.container import Container
from sqlalchemy import text

from lib.db import Database
from lib.utils.timeutils import utcnow

pytestmark = [pytest.mark.requires_postgres, pytest.mark.usefixtures("_clean")]
TOPIC = "opcua:cleanup-test"


class SubscribingSocket:
    """先订阅一次，再停在下一帧等待取消。"""

    def __init__(self) -> None:
        self.subscribed = asyncio.Event()
        self.connection_id: uuid.UUID | None = None
        self._first = True

    async def send_json(self, message: dict[str, object]) -> None:
        if message.get("event") == "connected":
            raw = message.get("connection_id")
            if isinstance(raw, str):
                self.connection_id = uuid.UUID(raw)
        if (
            message.get("type") == "ack"
            and message.get("action") == "subscribe"
        ):
            self.subscribed.set()

    async def receive_text(self) -> str:
        if self._first:
            self._first = False
            return json.dumps({"action": "subscribe", "topic": TOPIC})
        await asyncio.Event().wait()
        raise AssertionError("取消后不应再收到一帧")


class BlockedCleanup:
    """把真实删除操作停在可观察的等待点。"""

    def __init__(self, action: Callable[[uuid.UUID], Awaitable[None]]) -> None:
        self.action = action
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.finished = asyncio.Event()

    async def __call__(self, connection_id: uuid.UUID) -> None:
        self.entered.set()
        await self.release.wait()
        try:
            await self.action(connection_id)
        finally:
            self.finished.set()


async def subscription_count(
    database: Database, connection_id: uuid.UUID
) -> int:
    """查一条连接的真实订阅行数。Args: database, connection_id。"""
    async with database.session() as session:
        found = await session.scalar(
            text("SELECT count(*) FROM subscription WHERE connection_id = :id"),
            {"id": connection_id},
        )
    return int(found or 0)


async def serve_with_cancel_scope(
    container: Container, socket: SubscribingSocket, scopes: list[CancelScope]
) -> None:
    """在可外部取消的域里跑真实会话。Args: container, socket, scopes。"""
    with CancelScope() as scope:
        scopes.append(scope)
        await _serve(
            cast("WebSocket", socket),
            container,
            Handshake(
                user_id=uuid.uuid4(),
                codes=frozenset({"opcua:view"}),
                expires_at=utcnow() + timedelta(minutes=15),
            ),
        )


async def test_cancel_waits_for_real_subscription_cleanup(
    application: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    """取消返回后的第一条查询就必须看到订阅已删除。"""
    container: Container = application.state.container
    await container.registry.declare(
        topic=TOPIC, required_code="opcua:view", publisher="test"
    )
    blocked = BlockedCleanup(container.journal.forget_all)
    monkeypatch.setattr(container.journal, "forget_all", blocked)
    socket = SubscribingSocket()
    scopes: list[CancelScope] = []
    task = asyncio.create_task(
        serve_with_cancel_scope(container, socket, scopes)
    )
    try:
        await asyncio.wait_for(socket.subscribed.wait(), timeout=5)
        assert socket.connection_id is not None
        assert (
            await subscription_count(container.database, socket.connection_id)
            == 1
        )
        scopes[0].cancel()
        await asyncio.wait_for(blocked.entered.wait(), timeout=5)
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(asyncio.shield(task), timeout=0.5)
        blocked.release.set()
        await asyncio.wait_for(task, timeout=5)
        assert (
            await subscription_count(container.database, socket.connection_id)
            == 0
        )
    finally:
        blocked.release.set()
        if scopes:
            scopes[0].cancel()
        await asyncio.gather(task, return_exceptions=True)
        if blocked.entered.is_set():
            await asyncio.wait_for(blocked.finished.wait(), timeout=5)
