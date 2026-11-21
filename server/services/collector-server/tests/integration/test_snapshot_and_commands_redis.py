"""守真 Redis 上的两条面：快照哈希与命令总线的一问一答。

⚠ 快照没有 TTL 的话，采集进程死掉后大屏会拿着一份永不更新的旧值当实时值看。
"""

import json
from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

import pytest
from redis.asyncio import Redis

from collector_server import container as wiring
from collector_server.apps.collect.plan.store import PlanStore
from collector_server.apps.collect.runtime.session import SourceSession
from collector_server.apps.collect.runtime.sink import SnapshotSink
from collector_server.apps.collect.runtime.supervisor import (
    CollectSupervisor,
    SnapshotLifecycle,
    SupervisorOptions,
)
from collector_server.commands import RedisCommandTransport
from collector_server.lease import RedisLease
from collector_server.settings import Settings
from collector_server.snapshot import RedisSnapshotStore
from collectwire import (
    REQUEST_KEY,
    TRACEPARENT_KEY,
    CollectPlan,
    PlanSource,
    reply_key,
    snapshot_key,
    snapshot_owner_stamp,
    snapshot_owners_key,
)

TTL_S = 30
TS_MS = 1_767_323_045_000
RETIRED_POINT_COUNT = 1_500


@pytest.fixture
async def client(redis_url: str) -> AsyncIterator[Any]:
    """一个原生客户端，用来从旁边核对写进去的东西。"""
    opened = Redis.from_url(redis_url, decode_responses=True, socket_timeout=2)
    yield opened
    await opened.aclose()


@pytest.fixture
async def snapshot_store(
    redis_url: str, snapshot_lease: RedisLease
) -> AsyncIterator[RedisSnapshotStore]:
    opened = RedisSnapshotStore(url=redis_url, lease=snapshot_lease)
    try:
        yield opened
    finally:
        await opened.close()


async def test_snapshot_lands_as_one_hash_per_source(
    redis_url: str, client: Any, snapshot_lease: RedisLease
) -> None:
    store = RedisSnapshotStore(url=redis_url, lease=snapshot_lease)
    source_id = uuid4()
    try:
        await store.write_many(
            {
                source_id: {
                    "outlet_temp": json.dumps({"value": 21.5, "ts_ms": TS_MS})
                }
            },
            ttl_s=TTL_S,
        )
        stored = await client.hget(snapshot_key(source_id), "outlet_temp")
        assert json.loads(stored)["value"] == 21.5
        owner = await client.hget(snapshot_owners_key(source_id), "outlet_temp")
        assert snapshot_lease.token is not None
        assert owner == snapshot_owner_stamp(snapshot_lease.token, stored)
    finally:
        await store.drop(source_id)
        await store.close()


async def test_snapshot_key_always_carries_an_expiry(
    redis_url: str, client: Any, snapshot_lease: RedisLease
) -> None:
    store = RedisSnapshotStore(url=redis_url, lease=snapshot_lease)
    source_id = uuid4()
    try:
        await store.write_many({source_id: {"a": "1"}}, ttl_s=TTL_S)
        assert 0 < await client.ttl(snapshot_key(source_id)) <= TTL_S
    finally:
        await store.drop(source_id)
        await store.close()


async def test_touching_pushes_the_expiry_out_without_new_readings(
    redis_url: str, client: Any, snapshot_lease: RedisLease
) -> None:
    store = RedisSnapshotStore(url=redis_url, lease=snapshot_lease)
    source_id = uuid4()
    try:
        await store.write_many({source_id: {"a": "1"}}, ttl_s=1)
        await store.touch([source_id], ttl_s=TTL_S)
        # 值一天才变一次的点位靠这一步活着，否则整个键会到期消失
        assert await client.ttl(snapshot_key(source_id)) > 1
        assert await client.ttl(snapshot_owners_key(source_id)) > 1
    finally:
        await store.drop(source_id)
        await store.close()


async def test_touching_an_absent_source_creates_nothing(
    redis_url: str, client: Any, snapshot_lease: RedisLease
) -> None:
    store = RedisSnapshotStore(url=redis_url, lease=snapshot_lease)
    source_id = uuid4()
    try:
        await store.touch([source_id], ttl_s=TTL_S)
        # 续期不许凭空造键：那会造出一个没有任何点位的空快照
        assert (
            await client.exists(
                snapshot_key(source_id), snapshot_owners_key(source_id)
            )
            == 0
        )
    finally:
        await store.close()


async def test_dropping_a_source_removes_its_snapshot(
    redis_url: str, client: Any, snapshot_lease: RedisLease
) -> None:
    store = RedisSnapshotStore(url=redis_url, lease=snapshot_lease)
    source_id = uuid4()
    try:
        await store.write_many({source_id: {"a": "1"}}, ttl_s=TTL_S)
        await store.drop(source_id)
        assert (
            await client.exists(
                snapshot_key(source_id), snapshot_owners_key(source_id)
            )
            == 0
        )
    finally:
        await store.close()


@pytest.fixture
def snapshot_plans(
    build_plan: Any, build_source: Any
) -> tuple[CollectPlan, CollectPlan]:
    """同一数据源的旧计划含有 retired，新计划不再采集它。"""
    source = build_source(source_id=uuid4())
    retired = source.points[0].model_copy(update={"point_code": "retired"})
    previous = source.model_copy(update={"points": (*source.points, retired)})
    return (
        build_plan(version="v2", sources=(source,)),
        build_plan(sources=(previous,)),
    )


@pytest.mark.parametrize(
    "is_takeover", [True, False], ids=["takeover", "change"]
)
async def test_retired_point_fields_are_removed_without_losing_other_values(
    snapshot_store: RedisSnapshotStore,
    client: Any,
    build_plan_view: Any,
    snapshot_plans: tuple[CollectPlan, CollectPlan],
    is_takeover: bool,
) -> None:
    store = snapshot_store
    current, previous = snapshot_plans
    source_id = current.sources[0].source_id
    view = build_plan_view(current if is_takeover else previous)
    sink = SnapshotSink(store=store, plan=view, interval_ms=50, ttl_s=TTL_S)
    record = sink.sink_for(source_id)
    fields = {f"retired_{index}": "old" for index in range(RETIRED_POINT_COUNT)}
    fields.update({"outlet_temp": "still current", "retired": "old"})
    try:
        await store.write_many({source_id: fields}, ttl_s=TTL_S)
        if not is_takeover:
            await sink.flush_once()
            view.replace(current)
        record("retired", 42.0, TS_MS, "good")
        await sink.flush_once()
        assert await client.hgetall(snapshot_key(source_id)) == {
            "outlet_temp": "still current"
        }
        assert store.lease_token is not None
        assert await client.hgetall(snapshot_owners_key(source_id)) == {
            "outlet_temp": snapshot_owner_stamp(
                store.lease_token, "still current"
            )
        }
    finally:
        await store.drop(source_id)
        await store.close()


async def test_an_unreachable_redis_surfaces_as_a_dependency_failure(
    snapshot_lease: RedisLease,
) -> None:
    store = RedisSnapshotStore(
        url="redis://127.0.0.1:1/0", lease=snapshot_lease, timeout_s=0.2
    )
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


@pytest.mark.parametrize("operation", ["write", "touch", "drop", "retain"])
async def test_expired_holder_cannot_change_successor_snapshot(
    client: Any,
    live_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    lease_key = f"collect:test:leader:{uuid4()}"
    source_id = uuid4()
    key = snapshot_key(source_id)
    monkeypatch.setattr(wiring, "LEASE_KEY", lease_key)
    faces = wiring._build_redis(live_settings)
    try:
        assert await faces.lease.acquire()
        await client.set(lease_key, "successor", ex=TTL_S)
        await client.hset(key, mapping={"temperature": "successor"})
        await client.expire(key, TTL_S)
        if operation == "write":
            await faces.snapshot.write_many(
                {source_id: {"temperature": "old"}}, ttl_s=2 * TTL_S
            )
        elif operation == "touch":
            await faces.snapshot.touch([source_id], ttl_s=2 * TTL_S)
        elif operation == "drop":
            await faces.snapshot.drop(source_id)
        else:
            await faces.snapshot.retain_fields(source_id, frozenset())
        assert await client.hgetall(key) == {"temperature": "successor"}
        assert 0 < await client.ttl(key) <= TTL_S
    finally:
        await client.delete(lease_key, key)
        await faces.lease.close()
        await faces.snapshot.close()
        await faces.stream.close()
        await faces.transport.close()


def _supervisor_with_sink(
    faces: wiring.RedisFaces,
) -> tuple[CollectSupervisor, SnapshotSink]:
    class EmptyPlan:
        async def fetch(self) -> CollectPlan:
            return CollectPlan(version="test", sources=())

    def no_session(_source: PlanSource) -> SourceSession:
        raise AssertionError("空采集计划不建立会话")

    sink = SnapshotSink(store=faces.snapshot, interval_ms=50, ttl_s=TTL_S)
    supervisor = CollectSupervisor(
        lease=faces.lease,
        plan=PlanStore(fetcher=EmptyPlan()),
        builder=no_session,
        options=SupervisorOptions(
            plan_refresh_interval_s=30,
            snapshot=SnapshotLifecycle(
                discard=sink.discard_windows, flush=sink.flush_once
            ),
        ),
    )
    sink.bind_liveness(supervisor)
    return supervisor, sink


@pytest.fixture
async def leased_faces(
    live_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[wiring.RedisFaces]:
    monkeypatch.setattr(wiring, "LEASE_KEY", f"collect:test:leader:{uuid4()}")
    faces = wiring._build_redis(live_settings)
    try:
        yield faces
    finally:
        await faces.lease.release()
        await faces.lease.close()
        await faces.snapshot.close()
        await faces.stream.close()
        await faces.transport.close()


async def test_graceful_shutdown_flushes_the_last_window_before_releasing(
    leased_faces: wiring.RedisFaces, client: Any
) -> None:
    supervisor, sink = _supervisor_with_sink(leased_faces)
    source_id = uuid4()
    await supervisor.tick()
    token = leased_faces.lease.token
    assert token
    sink.sink_for(source_id)("tail", 42, TS_MS, "good")
    await supervisor.stop()
    key, owners = snapshot_key(source_id), snapshot_owners_key(source_id)
    try:
        assert await client.get(leased_faces.lease.key) is None
        payload = await client.hget(key, "tail")
        assert await client.hget(owners, "tail") == snapshot_owner_stamp(
            token, payload
        )
        assert json.loads(payload) == {
            "value": 42,
            "ts_ms": TS_MS,
            "quality": "good",
        }
    finally:
        await client.delete(key, owners)


async def test_reacquisition_discards_windows_from_the_old_session(
    leased_faces: wiring.RedisFaces, client: Any
) -> None:
    supervisor, sink = _supervisor_with_sink(leased_faces)
    source_id = uuid4()
    await supervisor.tick()
    previous = leased_faces.lease.token
    old = sink.sink_for(source_id)
    old("same", "old window", TS_MS, "good")
    await client.delete(leased_faces.lease.key)
    await supervisor.tick()
    await supervisor.tick()
    new = sink.sink_for(source_id)
    old("same", "late old callback", TS_MS, "good")
    new("new", "fresh", TS_MS, "good")
    await sink.flush_once()
    key, owners = snapshot_key(source_id), snapshot_owners_key(source_id)
    try:
        assert leased_faces.lease.token != previous
        assert await client.hkeys(key) == ["new"]
        token = leased_faces.lease.token
        assert token is not None
        payload = await client.hget(key, "new")
        assert await client.hgetall(owners) == {
            "new": snapshot_owner_stamp(token, payload)
        }
    finally:
        await supervisor.stop()
        await client.delete(key, owners)


async def test_handoff_during_hscan_protects_the_successor_fields(
    snapshot_store: RedisSnapshotStore,
    snapshot_lease: RedisLease,
    client: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = uuid4()
    key, owners = snapshot_key(source_id), snapshot_owners_key(source_id)
    await snapshot_store.write_many(
        {source_id: {"retired": "old"}}, ttl_s=TTL_S
    )
    scan = snapshot_store._client.hscan

    async def scan_then_takeover(*args: Any, **kwargs: Any) -> Any:
        result = await scan(*args, **kwargs)
        await client.set(snapshot_lease.key, "successor", ex=TTL_S)
        await client.hset(key, "retired", "new reading")
        await client.hset(
            owners, "retired", snapshot_owner_stamp("successor", "new reading")
        )
        return result

    monkeypatch.setattr(snapshot_store._client, "hscan", scan_then_takeover)
    try:
        await snapshot_store.retain_fields(source_id, frozenset())
        assert await client.hget(key, "retired") == "new reading"
        assert await client.hget(owners, "retired") == snapshot_owner_stamp(
            "successor", "new reading"
        )
    finally:
        await client.delete(key, owners, snapshot_lease.key)
