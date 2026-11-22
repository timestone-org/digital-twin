"""在隔离 Redis 队列和进程内假设备上验证写值的幂等保护。"""

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, replace
from typing import Any
from uuid import uuid4

import httpx
import pytest
from conftest import AppContext, CollectFakes
from fastapi import FastAPI
from redis.asyncio import Redis

from collectwire import ACTION_WRITE, reply_key
from integration.collect_helpers import POINTS, create_points, create_source
from lib.cache import Cache
from lib.errors import DependencyUnavailable
from lib.idempotency import RESULT_TTL_S, IdempotencyStore
from platform_server.apps.collect.services import command_transport
from platform_server.apps.collect.services.command_transport import (
    RedisCommandTransport,
)

pytestmark = pytest.mark.requires_postgres
KEY = {"Idempotency-Key": "same-operation"}
VALUE = {"value": 31.25}


class _WriteCache(Cache):
    """真正的 Redis 占位，可单独令更新占位或缓存回执失败。"""

    should_fail_result = False
    should_fail_renew = False

    async def set_json(self, key: str, value: Any, *, ttl_s: int) -> None:
        if self.should_fail_result:
            raise DependencyUnavailable("QA 回执缓存不可用")
        await super().set_json(key, value, ttl_s=ttl_s)

    async def renew_if_owner(
        self,
        key: str,
        value: str,
        *,
        ttl_s: int,
        replacement: str | None = None,
    ) -> bool:
        if self.should_fail_renew:
            raise DependencyUnavailable("QA 无法更新占位")
        return await super().renew_if_owner(
            key, value, ttl_s=ttl_s, replacement=replacement
        )


@dataclass
class _WriteRig:
    """一条测试专属 Redis 队列和一个可写的假设备输入。"""

    client: Redis
    queue: str
    path: str
    cache: _WriteCache
    namespace: str
    command_timeout_s: float = 0.1

    async def receive(self, *, should_confirm: bool = False) -> object:
        """假设备接受一条写值，可选择返回回执。Args: should_confirm。"""
        message = await self.client.blpop(self.queue, timeout=2)
        assert message
        command: dict[str, Any] = json.loads(message[1])
        assert command["action"] == ACTION_WRITE
        if should_confirm:
            key = reply_key(command["request_id"])
            await self.client.lpush(
                key, json.dumps({"status": "ok", "data": {}})
            )
            await self.client.expire(key, 30)
        return command["value"]

    async def reservation_ttl(self) -> int:
        keys = [
            key
            async for key in self.client.scan_iter(
                f"{self.namespace}:idem:claim:*"
            )
        ]
        assert len(keys) == 1
        return await self.client.ttl(keys[0])


@pytest.fixture
async def rig(
    app_context: AppContext,
    collect_fakes: CollectFakes,
    redis_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[_WriteRig]:
    """真实 Redis 占位和命令队列，数据库继续使用既有隔离夹具。"""
    source = await create_source(app_context.client)
    points = await create_points(app_context.client, source["id"])
    path = f"{POINTS}/{points['items'][0]['id']}:write"
    namespace = f"qa:collect-write:{uuid4()}"
    queue = f"{namespace}:queue"
    monkeypatch.setattr(command_transport, "REQUEST_KEY", queue)
    redis_transport = RedisCommandTransport(url=redis_url, block_s=1)
    cache = _WriteCache(url=redis_url)
    transport = app_context.client._transport
    assert isinstance(transport, httpx.ASGITransport)
    application = transport.app
    assert isinstance(application, FastAPI)
    application.state.container = replace(
        application.state.container,
        idempotency=IdempotencyStore(cache=cache, namespace=namespace),
    )
    async with Redis.from_url(redis_url, decode_responses=True) as client:
        built = _WriteRig(client, queue, path, cache, namespace)

        async def send(
            envelope: Mapping[str, Any], *, request_id: str, timeout_s: float
        ) -> dict[str, Any] | None:
            return await redis_transport.call(
                envelope,
                request_id=request_id,
                timeout_s=min(timeout_s, built.command_timeout_s),
            )

        monkeypatch.setattr(collect_fakes.bus, "call", send)
        try:
            yield built
        finally:
            keys = [key async for key in client.scan_iter(f"{namespace}:*")]
            if keys:
                await client.delete(*keys)
            await redis_transport.close()
            await cache.close()


async def test_same_key_after_lost_reply_never_enters_the_queue_again(
    app_client: httpx.AsyncClient, rig: _WriteRig
) -> None:
    device = asyncio.create_task(rig.receive())
    try:
        first = await app_client.post(rig.path, json=VALUE, headers=KEY)
        assert await device == VALUE["value"]
        repeated = await app_client.post(rig.path, json=VALUE, headers=KEY)
        assert (first.status_code, repeated.status_code) == (503, 409)
        assert await rig.client.llen(rig.queue) == 0
    finally:
        device.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await device


async def test_cancelled_request_keeps_full_window_after_enqueue(
    app_client: httpx.AsyncClient, rig: _WriteRig
) -> None:
    rig.command_timeout_s = 2
    waiting = asyncio.create_task(
        app_client.post(rig.path, json=VALUE, headers=KEY)
    )
    try:
        assert await rig.receive() == VALUE["value"]
        assert await rig.reservation_ttl() >= RESULT_TTL_S - 60
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        assert await rig.reservation_ttl() >= RESULT_TTL_S - 60
        repeated = await app_client.post(rig.path, json=VALUE, headers=KEY)
        assert repeated.status_code == 409
        assert "未确认" in repeated.json()["message"]
        assert await rig.client.llen(rig.queue) == 0
    finally:
        waiting.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await waiting


@pytest.mark.parametrize("should_confirm", [True, False], ids=["result", "cas"])
async def test_cache_write_failure_preserves_protection_window(
    app_client: httpx.AsyncClient, rig: _WriteRig, should_confirm: bool
) -> None:
    rig.cache.should_fail_result = should_confirm
    rig.cache.should_fail_renew = not should_confirm
    device = asyncio.create_task(rig.receive(should_confirm=should_confirm))
    try:
        first = await app_client.post(rig.path, json=VALUE, headers=KEY)
        assert await device == VALUE["value"]
        assert first.status_code == (200 if should_confirm else 503)
        assert await rig.reservation_ttl() >= RESULT_TTL_S - 60
        repeated = await app_client.post(rig.path, json=VALUE, headers=KEY)
        assert repeated.status_code == 409
        assert await rig.client.llen(rig.queue) == 0
    finally:
        device.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await device
