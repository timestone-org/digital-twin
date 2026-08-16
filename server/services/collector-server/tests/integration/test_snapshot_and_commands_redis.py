"""守真 Redis 上的两条面：快照哈希与命令总线的一问一答。

⚠ 快照没有 TTL 的话，采集进程死掉后大屏会拿着一份永不更新的旧值当实时值看。
"""

import json
from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

import pytest
from redis.asyncio import Redis

from collector_server.commands import RedisCommandTransport
from collector_server.snapshot import RedisSnapshotStore
from collectwire import (
    REQUEST_KEY,
    TRACEPARENT_KEY,
    reply_key,
    snapshot_key,
)

TTL_S = 30
TS_MS = 1_767_323_045_000


@pytest.fixture
async def client(redis_url: str) -> AsyncIterator[Any]:
    """一个原生客户端，用来从旁边核对写进去的东西。"""
    opened = Redis.from_url(redis_url, decode_responses=True, socket_timeout=2)
    yield opened
    await opened.aclose()


async def test_snapshot_lands_as_one_hash_per_source(
    redis_url: str, client: Any
) -> None:
    store = RedisSnapshotStore(url=redis_url)
    source_id = uuid4()
    try:
        await store.write(
            source_id,
            {"outlet_temp": json.dumps({"value": 21.5, "ts_ms": TS_MS})},
            ttl_s=TTL_S,
        )
        stored = await client.hget(snapshot_key(source_id), "outlet_temp")
        assert json.loads(stored)["value"] == 21.5
    finally:
        await store.drop(source_id)
        await store.close()


async def test_snapshot_key_always_carries_an_expiry(
    redis_url: str, client: Any
) -> None:
    store = RedisSnapshotStore(url=redis_url)
    source_id = uuid4()
    try:
        await store.write(source_id, {"a": "1"}, ttl_s=TTL_S)
        assert 0 < await client.ttl(snapshot_key(source_id)) <= TTL_S
    finally:
        await store.drop(source_id)
        await store.close()


async def test_dropping_a_source_removes_its_snapshot(
    redis_url: str, client: Any
) -> None:
    store = RedisSnapshotStore(url=redis_url)
    source_id = uuid4()
    try:
        await store.write(source_id, {"a": "1"}, ttl_s=TTL_S)
        await store.drop(source_id)
        assert await client.exists(snapshot_key(source_id)) == 0
    finally:
        await store.close()


async def test_an_unreachable_redis_surfaces_as_a_dependency_failure() -> None:
    store = RedisSnapshotStore(url="redis://127.0.0.1:1/0", timeout_s=0.2)
    try:
        assert await store.ping() is False
    finally:
        await store.close()


async def test_a_request_on_the_bus_is_taken_exactly_once(
    redis_url: str, client: Any
) -> None:
    transport = RedisCommandTransport(url=redis_url, block_s=1.0)
    try:
        await client.lpush(
            REQUEST_KEY, json.dumps({"request_id": "req-1", "action": "browse"})
        )
        first = await transport.take(block_s=1.0)
        second = await transport.take(block_s=0.1)
        assert first is not None
        assert first["request_id"] == "req-1"
        assert second is None
    finally:
        await client.delete(REQUEST_KEY)
        await transport.close()


async def test_a_reply_carries_the_trace_and_expires(
    redis_url: str, client: Any
) -> None:
    transport = RedisCommandTransport(url=redis_url, block_s=1.0)
    try:
        await transport.reply("req-2", {"status": "ok"}, ttl_s=TTL_S)
        stored = await client.lrange(reply_key("req-2"), 0, -1)
        envelope = json.loads(stored[0])
        assert envelope["status"] == "ok"
        assert TRACEPARENT_KEY in envelope
        assert 0 < await client.ttl(reply_key("req-2")) <= TTL_S
    finally:
        await client.delete(reply_key("req-2"))
        await transport.close()


async def test_a_corrupt_request_is_skipped_instead_of_killing_the_loop(
    redis_url: str, client: Any
) -> None:
    transport = RedisCommandTransport(url=redis_url, block_s=1.0)
    try:
        await client.lpush(REQUEST_KEY, "这不是 JSON")
        assert await transport.take(block_s=1.0) is None
    finally:
        await client.delete(REQUEST_KEY)
        await transport.close()
