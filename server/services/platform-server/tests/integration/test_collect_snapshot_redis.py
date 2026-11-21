"""守真 Redis 上的快照读：按数据源分组 HMGET、缺失就是缺失。

⚠ 这条链路的两端在两个仓里（collector 写、平台读），假件替掉 Redis 就等于把
「两侧编码一致」这件要验的事自己实现一遍。
"""

import json
import uuid
from collections.abc import AsyncIterator, Mapping

import pytest
from redis.asyncio import Redis

from collectwire import (
    FIELD_QUALITY,
    FIELD_TIMESTAMP_MS,
    FIELD_VALUE,
    snapshot_key,
    snapshot_owner_stamp,
    snapshot_owners_key,
)
from lib.errors import DependencyUnavailable
from platform_server.apps.collect.services import snapshot_source
from platform_server.apps.collect.services.point_frames import build_items
from platform_server.apps.collect.services.snapshot_source import (
    RedisSnapshotSource,
)
from timeseries import compose_node_key

NOW_MS = 1_760_000_000_000
SNAPSHOT_TTL_S = 60


@pytest.fixture
def source_id() -> uuid.UUID:
    """一个每条用例都不一样的数据源。"""
    return uuid.uuid4()


@pytest.fixture
async def snapshots(redis_url: str) -> AsyncIterator[RedisSnapshotSource]:
    """一条打真 Redis 的快照读连接。

    Args: redis_url。
    """
    source = RedisSnapshotSource(url=redis_url, timeout_s=2.0)
    yield source
    await source.close()


async def seed(
    url: str, source_id: uuid.UUID, fields: Mapping[str, object]
) -> None:
    """按 collector 的编码写一份快照，并给它 TTL。

    Args: url, source_id, fields。
    """
    client = Redis.from_url(  # pyright: ignore[reportUnknownMemberType]
        url, decode_responses=True, socket_timeout=2
    )
    encoded = {
        point_code: json.dumps(
            {
                FIELD_VALUE: value,
                FIELD_TIMESTAMP_MS: NOW_MS,
                FIELD_QUALITY: "good",
            }
        )
        for point_code, value in fields.items()
    }
    try:
        await client.hset(  # pyright: ignore[reportUnknownMemberType]
            snapshot_key(source_id), mapping=encoded
        )
        await client.expire(snapshot_key(source_id), SNAPSHOT_TTL_S)
    finally:
        await client.aclose()


async def test_the_values_collector_wrote_come_back_by_identity(
    snapshots: RedisSnapshotSource, redis_url: str, source_id: uuid.UUID
) -> None:
    await seed(redis_url, source_id, {"outlet_temp": 21.5, "inlet_temp": 18.0})
    outlet = compose_node_key(source_id, "outlet_temp")
    readings = await snapshots.read([outlet])
    assert readings[outlet].value == 21.5
    assert readings[outlet].timestamp_ms == NOW_MS
    assert readings[outlet].quality == "good"


async def test_a_point_that_was_never_reported_is_simply_absent(
    snapshots: RedisSnapshotSource, redis_url: str, source_id: uuid.UUID
) -> None:
    # ⚠ 补一个零值等于凭空造一条现场读数
    await seed(redis_url, source_id, {"outlet_temp": 21.5})
    missing = compose_node_key(source_id, "nowhere")
    readings = await snapshots.read([missing])
    assert readings == {}


async def test_a_source_with_no_snapshot_at_all_reads_empty(
    snapshots: RedisSnapshotSource, source_id: uuid.UUID
) -> None:
    readings = await snapshots.read([compose_node_key(source_id, "outlet")])
    assert readings == {}


async def test_points_from_two_sources_are_read_in_one_round(
    snapshots: RedisSnapshotSource, redis_url: str, source_id: uuid.UUID
) -> None:
    other_source = uuid.uuid4()
    await seed(redis_url, source_id, {"outlet_temp": 21.5})
    await seed(redis_url, other_source, {"run_state": True})
    keys = [
        compose_node_key(source_id, "outlet_temp"),
        compose_node_key(other_source, "run_state"),
    ]
    readings = await snapshots.read(keys)
    assert set(readings) == set(keys)


async def test_asking_for_nothing_touches_no_connection(
    snapshots: RedisSnapshotSource,
) -> None:
    assert await snapshots.read([]) == {}


async def test_a_live_redis_answers_the_selfcheck(
    snapshots: RedisSnapshotSource,
) -> None:
    assert await snapshots.ping() is True


async def test_an_unreachable_redis_fails_loudly_instead_of_reading_empty(
    source_id: uuid.UUID,
) -> None:
    # ⚠ 空结果与「这些点位确实没有值」分不开，故读不到必须抛
    source = RedisSnapshotSource(url="redis://127.0.0.1:1/0", timeout_s=0.2)
    try:
        with pytest.raises(DependencyUnavailable):
            await source.read([compose_node_key(source_id, "outlet_temp")])
        assert await source.ping() is False
    finally:
        await source.close()


async def _stamp(
    client: Redis, source_id: uuid.UUID, code: str, token: str
) -> None:
    """记录原始字段的属主证明。Args: client, source_id, code, token。"""
    payload = await client.hget(snapshot_key(source_id), code)
    assert isinstance(payload, str)
    await client.hset(
        snapshot_owners_key(source_id),
        code,
        snapshot_owner_stamp(token, payload),
    )


async def test_only_the_current_owner_makes_a_snapshot_fresh(
    snapshots: RedisSnapshotSource,
    redis_url: str,
    source_id: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lease_key = f"collect:test:leader:{uuid.uuid4()}"
    monkeypatch.setattr(
        snapshot_source, "COLLECT_LEASE_KEY", lease_key, raising=False
    )
    await seed(redis_url, source_id, {"hot": 21.5, "cold": 18.0})
    client = Redis.from_url(redis_url, decode_responses=True)
    keys = [compose_node_key(source_id, code) for code in ("hot", "cold")]
    owners_key = snapshot_owners_key(source_id)
    try:
        await _stamp(client, source_id, "hot", "old")
        await client.set(lease_key, "old", ex=60)
        initial = build_items(
            keys, await snapshots.read(keys), frozenset({source_id})
        )
        await client.delete(lease_key)
        expired = build_items(
            keys, await snapshots.read(keys), frozenset({source_id})
        )
        await client.set(lease_key, "next", ex=60)
        takeover = build_items(
            keys, await snapshots.read(keys), frozenset({source_id})
        )
        await _stamp(client, source_id, "cold", "next")
        sampled = build_items(
            keys, await snapshots.read(keys), frozenset({source_id})
        )
        assert [
            [item["state"] for item in frame]
            for frame in (initial, expired, takeover, sampled)
        ] == [
            ["ok", "stale"],
            ["stale", "stale"],
            ["stale", "stale"],
            ["stale", "ok"],
        ]
        assert [item["value"] for item in sampled] == [21.5, 18.0]
    finally:
        await client.delete(lease_key, owners_key, snapshot_key(source_id))
        await client.aclose()


async def test_legacy_writer_values_remain_visible_but_stale_on_rollback(
    snapshots: RedisSnapshotSource,
    redis_url: str,
    source_id: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lease_key = f"collect:test:leader:{uuid.uuid4()}"
    monkeypatch.setattr(snapshot_source, "COLLECT_LEASE_KEY", lease_key)
    owner_key = snapshot_owners_key(source_id)
    raw = Redis.from_url(redis_url, decode_responses=True)
    keys = [
        compose_node_key(source_id, code)
        for code in ("temperature", "pressure")
    ]
    try:
        await raw.hset(owner_key, "temperature", "previous-fenced-writer")
        await raw.set(lease_key, "legacy-writer", ex=60)
        await seed(redis_url, source_id, {"temperature": 28.5, "pressure": 12})
        current = await snapshots.read(keys)
        items = build_items(keys, current, frozenset({source_id}))
        assert [(item["state"], item["value"]) for item in items] == [
            ("stale", 28.5),
            ("stale", 12),
        ]
        assert all(item["timestampMs"] == NOW_MS for item in items)
    finally:
        await raw.delete(lease_key, owner_key, snapshot_key(source_id))
        await raw.aclose()


@pytest.mark.parametrize(
    "changed",
    [{"value": 23.0}, {"ts_ms": NOW_MS + 1}, {"quality": "uncertain"}],
    ids=["value", "same-value-new-time", "same-value-new-quality"],
)
async def test_late_legacy_write_cannot_reuse_the_current_owner_stamp(
    snapshots: RedisSnapshotSource,
    redis_url: str,
    source_id: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
    changed: Mapping[str, object],
) -> None:
    lease_key = f"collect:test:leader:{uuid.uuid4()}"
    monkeypatch.setattr(snapshot_source, "COLLECT_LEASE_KEY", lease_key)
    key, owners = snapshot_key(source_id), snapshot_owners_key(source_id)
    point = compose_node_key(source_id, "temperature")
    owner = "current-collector"
    before = {"value": 21.5, "ts_ms": NOW_MS, "quality": "good"}
    original = json.dumps(before)
    legacy = before | changed
    raw = Redis.from_url(redis_url, decode_responses=True)
    try:
        await raw.set(lease_key, owner, ex=60)
        await raw.hset(key, "temperature", original)
        await raw.hset(
            owners, "temperature", snapshot_owner_stamp(owner, original)
        )
        assert (await snapshots.read([point]))[point].is_current
        await raw.hset(key, "temperature", json.dumps(legacy))
        found = (await snapshots.read([point]))[point]
        assert not found.is_current
        assert (found.value, found.timestamp_ms, found.quality) == (
            legacy["value"],
            legacy["ts_ms"],
            legacy["quality"],
        )
    finally:
        await raw.delete(lease_key, key, owners)
        await raw.aclose()
