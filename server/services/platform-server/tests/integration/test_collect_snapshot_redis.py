"""守真 Redis 上的快照读：按数据源分组 HMGET、缺失就是缺失。

⚠ 这条链路的两端在两个仓里（collector 写、平台读），假件替掉 Redis 就等于把
「两侧编码一致」这件要验的事自己实现一遍。
"""

import json
import uuid
from collections.abc import AsyncIterator, Mapping

import pytest
from redis.asyncio import Redis

from lib.errors import DependencyUnavailable
from platform_server.apps.collect.services.snapshot_source import (
    FIELD_QUALITY,
    FIELD_TIMESTAMP_MS,
    FIELD_VALUE,
    RedisSnapshotSource,
    snapshot_key,
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
