"""用真实 OPC UA 会话验证稳定点位的初值能进入 Redis 快照。"""

import asyncio
import json
import os
import sys
from collections.abc import AsyncIterator
from uuid import UUID

import pytest
from redis.asyncio import Redis

from collector_server.apps.collect.drivers.base import (
    DriverConnection,
    PointSpec,
)
from collector_server.apps.collect.drivers.opcua.driver import OpcuaDriver
from collector_server.apps.collect.runtime.sink import SnapshotSink, ValueBuffer
from collector_server.snapshot import RedisSnapshotStore
from collectwire import snapshot_key

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
    opcua_endpoint: str, redis_url: str, source_id: UUID
) -> None:
    driver = OpcuaDriver(connection=DriverConnection(endpoint=opcua_endpoint))
    store = RedisSnapshotStore(url=redis_url)
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
