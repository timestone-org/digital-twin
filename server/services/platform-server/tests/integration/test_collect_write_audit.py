"""用真实 Redis、独立 PostgreSQL 会话和合成设备验证写值审计。"""

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import dataclass, replace
from uuid import UUID, uuid4

import httpx
import pytest
from conftest import SignHeaders
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from collectwire import ACTION_WRITE, REASON_WRITE_REJECTED, reply_key
from integration.collect_helpers import POINTS
from lib.db import Database
from platform_server.app import build_app
from platform_server.apps.collect.catalog import COLLECT_OPERATE
from platform_server.apps.collect.models import (
    CollectAuditEvent,
    CollectPoint,
    CollectSource,
)
from platform_server.apps.collect.services import command_transport
from platform_server.container import build_container
from platform_server.settings import Settings

pytestmark = [
    pytest.mark.requires_postgres,
    pytest.mark.usefixtures("_require_postgres"),
]
VALUE = {"value": 31.25}


@dataclass(frozen=True)
class LiveWrite:
    """一次性队列、已授权的 HTTP 客户端和真实数据库。"""

    client: httpx.AsyncClient
    redis: Redis
    queue: str
    database: Database
    point_id: UUID

    @property
    def path(self) -> str:
        return f"{POINTS}/{self.point_id}:write"

    async def receive(self) -> str:
        """从队列接一条正常写命令，返回请求编号。"""
        message = await self.redis.blpop(self.queue, timeout=3)
        assert message is not None
        command = json.loads(message[1])
        assert command["action"] == ACTION_WRITE
        assert command["value"] == VALUE["value"]
        return str(command["request_id"])

    async def events(self) -> list[CollectAuditEvent]:
        """用独立数据库会话读取真实已提交事件。"""
        async with self.database.session() as session:
            rows = await session.scalars(
                select(CollectAuditEvent)
                .where(CollectAuditEvent.target_id == self.point_id)
                .order_by(CollectAuditEvent.id)
            )
            values = list(rows)
            session.expunge_all()
            return values


async def _seed(database: Database) -> tuple[UUID, UUID]:
    source_id, point_id = uuid4(), uuid4()
    async with database.session() as session:
        session.add(
            CollectSource(
                id=source_id,
                name="合成来源",
                code=f"audit-{source_id.hex}",
                protocol="opcua",
                endpoint="opc.tcp://127.0.0.1:1",
                read_mode="poll",
                poll_interval_ms=1000,
                is_enabled=False,
            )
        )
        await session.flush()
        session.add(
            CollectPoint(
                id=point_id,
                source_id=source_id,
                name="合成点位",
                code="synthetic",
                address="ns=2;s=Synthetic",
                data_type="float",
                sampling_interval_ms=1000,
                deadband=0,
                archive_enabled=False,
                archive_max_interval_ms=1000,
            )
        )
    return source_id, point_id


@pytest.fixture
async def live_write(
    settings: Settings,
    redis_url: str,
    sign: SignHeaders,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[LiveWrite]:
    queue = f"qa:collect-audit:{uuid4()}"
    monkeypatch.setattr(command_transport, "REQUEST_KEY", queue)
    tuned = settings.model_copy(update={"collect_command_timeout_s": 1.0})
    app = build_app(tuned)
    container = build_container(tuned)
    app.state.container = replace(
        container, idempotency=replace(container.idempotency, namespace=queue)
    )
    source_id, point_id = await _seed(container.database)
    async with (
        Redis.from_url(redis_url, decode_responses=True) as redis,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://platform-test",
            headers=sign((COLLECT_OPERATE,)),
        ) as client,
    ):
        try:
            yield LiveWrite(client, redis, queue, container.database, point_id)
        finally:
            keys = [key async for key in redis.scan_iter(f"{queue}*")]
            if keys:
                await redis.delete(*keys)
            async with container.database.session() as session:
                source = await session.get(CollectSource, source_id)
                assert source is not None
                await session.delete(source)
            await container.command_transport.close()
            await container.cache.close()
            await container.database.dispose()


@pytest.mark.parametrize(
    ("mode", "status", "event"),
    [
        ("confirmed", 200, "write_confirmed"),
        ("rejected", 400, "write_rejected"),
        ("timeout", 503, "write_unconfirmed"),
        ("legacy_error", 503, "write_unconfirmed"),
    ],
)
async def test_real_queue_has_committed_intent_before_the_device_reply(
    live_write: LiveWrite, mode: str, status: int, event: str
) -> None:
    headers = {"Idempotency-Key": str(uuid4())}
    pending = asyncio.create_task(
        live_write.client.post(live_write.path, json=VALUE, headers=headers)
    )
    try:
        request_id = await live_write.receive()
        [intent] = await live_write.events()
        assert intent.event_kind == "write_intent"
        assert intent.before_json is intent.after_json is None
        if mode != "timeout":
            response = (
                {"status": "ok", "data": {}}
                if mode == "confirmed"
                else {
                    "status": "error",
                    "reason": (
                        REASON_WRITE_REJECTED
                        if mode == "rejected"
                        else "driver_failed"
                    ),
                }
            )
            await live_write.redis.lpush(
                reply_key(request_id), json.dumps(response)
            )
        assert (await pending).status_code == status
    finally:
        if not pending.done():
            pending.cancel()
            with suppress(asyncio.CancelledError):
                await pending
    _, settled = await live_write.events()
    assert settled.event_kind == event
    assert settled.intent_id == intent.id
    if mode != "rejected":
        replay = await live_write.client.post(
            live_write.path, json=VALUE, headers=headers
        )
        assert replay.status_code == (200 if mode == "confirmed" else 409)
        assert len(await live_write.events()) == 2
        assert await live_write.redis.llen(live_write.queue) == 0


async def test_audit_settlement_commit_failure_keeps_the_device_hold(
    live_write: LiveWrite, monkeypatch: pytest.MonkeyPatch
) -> None:
    commit = AsyncSession.commit

    async def fail_settlement(session: AsyncSession) -> None:
        for row in session.new:
            if isinstance(row, CollectAuditEvent) and row.intent_id is not None:
                raise OSError("合成结算提交失败")
        await commit(session)

    monkeypatch.setattr(AsyncSession, "commit", fail_settlement)
    headers = {"Idempotency-Key": str(uuid4())}
    pending = asyncio.create_task(
        live_write.client.post(live_write.path, json=VALUE, headers=headers)
    )
    try:
        request_id = await live_write.receive()
        await live_write.redis.lpush(
            reply_key(request_id), '{"status":"ok","data":{}}'
        )
        assert (await pending).status_code == 503
    finally:
        if not pending.done():
            pending.cancel()
            with suppress(asyncio.CancelledError):
                await pending
    assert [row.event_kind for row in await live_write.events()] == [
        "write_intent"
    ]
    repeated = await live_write.client.post(
        live_write.path, json=VALUE, headers=headers
    )
    assert repeated.status_code == 409
    assert await live_write.redis.llen(live_write.queue) == 0


async def test_cancellation_leaves_unsettled_intent_and_keeps_hold(
    live_write: LiveWrite,
) -> None:
    headers = {"Idempotency-Key": str(uuid4())}
    pending = asyncio.create_task(
        live_write.client.post(live_write.path, json=VALUE, headers=headers)
    )
    try:
        await live_write.receive()
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
    finally:
        if not pending.done():
            pending.cancel()
            with suppress(asyncio.CancelledError):
                await pending
    [intent] = await live_write.events()
    assert intent.event_kind == "write_intent"
    repeated = await live_write.client.post(
        live_write.path, json=VALUE, headers=headers
    )
    assert repeated.status_code == 409
    assert await live_write.redis.llen(live_write.queue) == 0


async def test_intent_commit_failure_does_not_send_a_device_command(
    live_write: LiveWrite, monkeypatch: pytest.MonkeyPatch
) -> None:
    commit = AsyncSession.commit

    async def reject_intent(session: AsyncSession) -> None:
        for row in session.new:
            if (
                isinstance(row, CollectAuditEvent)
                and row.event_kind == "write_intent"
            ):
                raise OSError("合成意图提交失败")
        await commit(session)

    monkeypatch.setattr(AsyncSession, "commit", reject_intent)
    response = await live_write.client.post(
        live_write.path, json=VALUE, headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code == 503
    assert "未下发" in response.json()["message"]
    assert await live_write.events() == []
    assert await live_write.redis.llen(live_write.queue) == 0


async def test_uncredentialed_device_request_is_not_audited(
    live_write: LiveWrite,
) -> None:
    live_write.client.headers.clear()
    response = await live_write.client.post(
        live_write.path, json=VALUE, headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code in (401, 403)
    assert await live_write.events() == []
    assert await live_write.redis.llen(live_write.queue) == 0
