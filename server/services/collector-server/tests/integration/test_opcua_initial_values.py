"""用真实 OPC UA 会话验证稳定点位的初值能进入 Redis 快照。"""

import asyncio
import json
import os
import sys
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

import pytest
from redis.asyncio import Redis

from collector_server.apps.collect.drivers.base import (
    DriverConnection,
    PointSpec,
)
from collector_server.apps.collect.drivers.opcua.driver import OpcuaDriver
from collector_server.apps.collect.plan.client import PlanClient
from collector_server.apps.collect.runtime.session import (
    SessionOptions,
    SourceSession,
    SourceStatus,
)
from collector_server.apps.collect.runtime.sink import SnapshotSink, ValueBuffer
from collector_server.apps.collect.services.state_service import (
    SourceStateService,
)
from collector_server.clock import utc_now_ms
from collector_server.container import Container, build_container
from collector_server.lease import RedisLease
from collector_server.settings import Settings
from collector_server.snapshot import RedisSnapshotStore
from collector_server.stream import stream_key
from collectwire import CollectPlan, PlanPoint, PlanSource, snapshot_key
from timeseries import Quality

# ⚠ 标准地址空间放在子进程初始化，避免第三方生成代码拖慢分支覆盖追踪。
SERVER_SOURCE = """
import asyncio
import signal
import sys
from asyncua import Server, ua

async def main():
    server = Server()
    await server.init()
    server.set_endpoint(sys.argv[1])
    namespace = await server.register_namespace('initial-values-test')
    for index in range(101):
        await server.nodes.objects.add_variable(
            ua.NodeId(f'p{index}', namespace), f'p{index}', float(index)
        )
    await server.nodes.objects.add_variable(
        ua.NodeId('running', namespace), 'running', False
    )
    stopped = asyncio.Event()
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stopped.set)
    async with server:
        print('READY', flush=True)
        await stopped.wait()

asyncio.run(main())
"""


@pytest.fixture
async def opcua_endpoint(unused_tcp_port: int) -> AsyncIterator[str]:
    """启动一个点位始终不变的本地 OPC UA 服务。"""
    endpoint = f"opc.tcp://127.0.0.1:{unused_tcp_port}/initial-values-test"
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        SERVER_SOURCE,
        endpoint,
        env={
            name: value
            for name, value in os.environ.items()
            if not name.startswith(("COVERAGE_", "COV_CORE_"))
        },
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        assert process.stdout is not None
        assert (
            await asyncio.wait_for(process.stdout.readline(), 60) == b"READY\n"
        )
        yield endpoint
    finally:
        if process.returncode is None:
            process.terminate()
            await asyncio.wait_for(process.wait(), 10)


async def test_static_points_land_in_snapshot_without_a_value_change(
    opcua_endpoint: str,
    redis_url: str,
    source_id: UUID,
    snapshot_lease: RedisLease,
) -> None:
    driver = OpcuaDriver(connection=DriverConnection(endpoint=opcua_endpoint))
    store = RedisSnapshotStore(url=redis_url, lease=snapshot_lease)
    client = Redis.from_url(redis_url, decode_responses=True, socket_timeout=2)
    sink = SnapshotSink(store=store, interval_ms=300, ttl_s=60)
    points = [
        PointSpec(f"p{index}", f"ns=2;s=p{index}", 60_000)
        for index in range(101)
    ]
    points.extend(
        [
            PointSpec("alias", "ns=2;s=p0", 60_000),
            PointSpec("running", "ns=2;s=running", 60_000),
        ]
    )
    try:
        await driver.connect()
        result = await driver.subscribe(points, sink.sink_for(source_id))
        await sink.flush_once()
        stored = await client.hgetall(snapshot_key(source_id))
        values = {code: json.loads(payload) for code, payload in stored.items()}
        assert len(result.accepted) == 103
        assert set(values) == {point.point_code for point in points}
        assert [values[f"p{index}"]["value"] for index in range(101)] == [
            float(index) for index in range(101)
        ]
        assert values["alias"]["value"] == 0.0
        assert values["running"]["value"] is False
        assert all(value["quality"] == "good" for value in values.values())
    finally:
        await driver.disconnect()
        await store.drop(source_id)
        await store.close()
        await client.aclose()


async def test_real_reconnection_repopulates_a_new_snapshot(
    opcua_endpoint: str,
) -> None:
    driver = OpcuaDriver(connection=DriverConnection(endpoint=opcua_endpoint))
    buffer = ValueBuffer()
    try:
        for _ in range(2):
            await driver.connect()
            await driver.subscribe(
                [PointSpec("stable", "ns=2;s=p100", 60_000)], buffer.record
            )
            values = buffer.swap()
            assert values["stable"][0] == 100.0
            assert values["stable"][2] == "good"
            await driver.disconnect()
    finally:
        await driver.disconnect()


async def test_changing_an_address_retargets_live_subscription(
    opcua_endpoint: str, build_source: Any, build_point: Any, reporter: Any
) -> None:
    first_sample = asyncio.Event()
    buffer = ValueBuffer()

    def receive(code: str, value: object, ts_ms: int, quality: Quality) -> None:
        buffer.record(code, value, ts_ms, quality)
        first_sample.set()

    original = build_source(
        endpoint=opcua_endpoint,
        points=(build_point("stable", address="ns=2;s=p0"),),
    )
    updated = original.model_copy(
        update={"points": (build_point("stable", address="ns=2;s=p100"),)}
    )
    session = SourceSession(
        source=original,
        driver=OpcuaDriver(
            connection=DriverConnection(endpoint=opcua_endpoint)
        ),
        sink=receive,
        options=SessionOptions(heartbeat_interval_s=10, max_backoff_s=30),
        reporter=reporter,
    )
    task = asyncio.create_task(session.run())
    try:
        await asyncio.wait_for(first_sample.wait(), timeout=10)
        assert buffer.swap()["stable"][0] == 0.0
        await session.apply(updated)
        sample = buffer.swap().get("stable")
        assert sample is not None
        assert sample[0] == 100.0
        assert reporter.states().count("connecting") == 1
    finally:
        await session.stop()
        await task


def _retarget_plan(
    endpoint: str, source_id: UUID, point_id: str
) -> CollectPlan:
    points = tuple(
        PlanPoint(
            point_code=code,
            address=f"ns=2;s={address}",
            sampling_interval_ms=1000,
            archive_max_interval_ms=1000,
        )
        for code, address in (("changed", point_id), ("neighbor", "p100"))
    )
    return CollectPlan(
        version=point_id,
        sources=(
            PlanSource(
                source_id=source_id,
                code="line-1",
                protocol="opcua",
                endpoint=endpoint,
                points=points,
            ),
        ),
    )


async def _archived_point_codes(
    container: Container, source_id: UUID
) -> list[str]:
    batches = await container.redis.stream.read(stream_key(source_id), count=10)
    return [row["point_code"] for batch in batches for row in batch.rows]


async def _flush_buffers(container: Container) -> None:
    await container.sink.flush_once()
    await container.archive.flush_once()


@pytest.mark.requires_redis
async def test_rejected_retarget_leaves_no_live_or_archived_old_value(
    opcua_endpoint: str,
    redis_url: str,
    live_settings: Settings,
    source_id: UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    plan = _retarget_plan(opcua_endpoint, source_id, "p0")
    ready = asyncio.Event()
    now = utc_now_ms()

    async def fetch(_: PlanClient) -> CollectPlan:
        return plan

    async def report(_: SourceStateService, status: SourceStatus) -> None:
        if status.state == "online":
            ready.set()

    monkeypatch.setattr(PlanClient, "fetch", fetch)
    monkeypatch.setattr(SourceStateService, "report", report)
    container = build_container(live_settings)
    monkeypatch.setattr(container.archive, "_clock", lambda: now)
    key = snapshot_key(source_id)
    async with Redis.from_url(redis_url, decode_responses=True) as redis:
        try:
            await container.supervisor.tick()
            await asyncio.wait_for(ready.wait(), timeout=10)
            await _flush_buffers(container)
            assert json.loads(await redis.hget(key, "changed"))["value"] == 0

            plan = _retarget_plan(opcua_endpoint, source_id, "missing")
            container.supervisor.request_plan_refresh()
            await container.supervisor.tick()
            now += 5000
            await _flush_buffers(container)

            changed = json.loads(await redis.hget(key, "changed"))
            neighbor = json.loads(await redis.hget(key, "neighbor"))
            assert (changed["value"], changed["quality"]) == (None, "bad")
            assert (neighbor["value"], neighbor["quality"]) == (100.0, "good")
            codes = await _archived_point_codes(container, source_id)
            assert codes.count("changed") == 1
            assert codes.count("neighbor") == 2
        finally:
            await container.supervisor.stop()
            await redis.delete(key, stream_key(source_id))
            await container.redis.lease.close()
            await container.redis.snapshot.close()
            await container.redis.stream.close()
