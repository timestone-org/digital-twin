"""本机 Modbus TCP 假设备证明真实协议请求只读取已配置地址。"""

import asyncio
import json
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast
from uuid import UUID, uuid4

from pymodbus import server as modbus_server
from pymodbus.datastore import (
    ModbusDeviceContext,
    ModbusSequentialDataBlock,
    ModbusServerContext,
)
from redis.asyncio import Redis
from sqlalchemy import text

from collector_server.apps.collect.archive.buffer import (
    ArchiveBuffer,
    ArchiveOptions,
)
from collector_server.apps.collect.archive.writer import (
    ArchiveWriter,
    WriterOptions,
)
from collector_server.apps.collect.drivers.base import (
    DriverConnection,
    PointSpec,
    WriteNotSupported,
)
from collector_server.apps.collect.drivers.modbus_tcp.driver import (
    ModbusTcpDriver,
)
from collector_server.apps.collect.runtime.sink import SnapshotSink, fan_out
from collector_server.apps.collect.services import PointHistoryService
from collector_server.snapshot import RedisSnapshotStore
from collector_server.stream import RedisArchiveStream, stream_key
from collectwire import CollectPlan, PlanPoint, PlanSource, snapshot_key
from lib.db import Database


def _loopback_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


async def _serve(context: ModbusServerContext, port: int) -> None:
    # pymodbus 的服务端入口用未标注的 **kwargs，入口只在本机集成测试调用。
    start = cast(
        Callable[..., Awaitable[None]],
        modbus_server.StartAsyncTcpServer,  # pyright: ignore[reportUnknownMemberType]
    )
    await start(context, address=("127.0.0.1", port))


async def test_loopback_device_is_read_without_write_capability() -> None:
    port = _loopback_port()
    device = ModbusDeviceContext(
        hr=ModbusSequentialDataBlock(1, [7, 0x4148, 0x0000])
    )
    context = ModbusServerContext(devices={1: device}, single=False)
    server = asyncio.create_task(_serve(context, port))
    endpoint = f"modbus.tcp://127.0.0.1:{port}"
    driver = ModbusTcpDriver(
        connection=DriverConnection(
            endpoint=endpoint,
            is_network_access_enabled=True,
            allowed_endpoints=frozenset({f"127.0.0.1:{port}"}),
        )
    )
    driver.load_points(
        [
            PointSpec("count", "holding:0:uint16", 1000, "int"),
            PointSpec("temperature", "holding:1:float32", 1000, "float"),
        ]
    )
    try:
        await asyncio.sleep(0.05)
        await driver.connect()
        samples = await driver.read_many(["temperature", "count"])
        assert samples[0][0] == 12.5
        assert samples[0][2] == "good"
        assert samples[1][0] == 7
        assert samples[1][2] == "good"
        try:
            await driver.write("count", 9)
        except WriteNotSupported:
            pass
        else:
            raise AssertionError("只读驱动接受了写值")
        unchanged = await driver.read_many(["count"])
        assert unchanged[0][0] == 7
    finally:
        await driver.disconnect()
        await modbus_server.ServerAsyncStop()
        await server


def _plan(source_id: UUID, endpoint: str) -> CollectPlan:
    return CollectPlan(
        version="modbus-loopback",
        sources=(
            PlanSource(
                source_id=source_id,
                code="modbus-loopback",
                protocol="modbus_tcp",
                endpoint=endpoint,
                points=(
                    PlanPoint(
                        point_code="temperature",
                        address="holding:1:float32",
                        data_type="float",
                        sampling_interval_ms=1000,
                    ),
                ),
            ),
        ),
    )


@dataclass
class _Pipeline:
    snapshots: SnapshotSink
    archives: ArchiveBuffer
    writer: ArchiveWriter
    snapshot_store: RedisSnapshotStore
    archive_stream: RedisArchiveStream
    raw_redis: Redis


def _pipeline(redis_url: str, database: Database, view: Any) -> _Pipeline:
    snapshot_store = RedisSnapshotStore(url=redis_url)
    archive_stream = RedisArchiveStream(url=redis_url)
    raw_redis = Redis.from_url(  # pyright: ignore[reportUnknownMemberType]
        redis_url, decode_responses=True
    )
    snapshots = SnapshotSink(
        store=snapshot_store, interval_ms=300, ttl_s=60, plan=view
    )
    archives = ArchiveBuffer(
        stream=archive_stream,
        plan=view,
        options=ArchiveOptions(
            flush_interval_ms=5000,
            max_rows=100,
            batch_rows=10,
            stream_maxlen=1000,
        ),
    )
    return _Pipeline(
        snapshots=snapshots,
        archives=archives,
        writer=ArchiveWriter(
            stream=archive_stream,
            store=PointHistoryService(database=database, batch_rows=10),
            options=WriterOptions(flush_interval_ms=5000),
        ),
        snapshot_store=snapshot_store,
        archive_stream=archive_stream,
        raw_redis=raw_redis,
    )


async def _assert_value(
    pipeline: _Pipeline, database: Database, source_id: UUID, ts_ms: int
) -> None:
    raw = await pipeline.raw_redis.hget(snapshot_key(source_id), "temperature")
    assert raw is not None
    assert json.loads(raw) == {
        "value": 12.5,
        "ts_ms": ts_ms,
        "quality": "good",
    }
    async with database.session() as session:
        result = await session.execute(
            text(
                "SELECT value_num, quality FROM collect.point_history "
                "WHERE source_id = :source_id AND point_code = 'temperature'"
            ),
            {"source_id": str(source_id)},
        )
        assert result.one() == (12.5, "good")


async def _cleanup(
    pipeline: _Pipeline, database: Database, source_id: UUID
) -> None:
    await pipeline.raw_redis.delete(
        snapshot_key(source_id), stream_key(source_id)
    )
    await pipeline.raw_redis.aclose()
    await pipeline.snapshot_store.close()
    await pipeline.archive_stream.close()
    async with database.session() as session:
        await session.execute(
            text(
                "DELETE FROM collect.point_history WHERE source_id = :source_id"
            ),
            {"source_id": str(source_id)},
        )


async def test_loopback_value_reaches_redis_and_timescale(
    redis_url: str, database: Database, build_plan_view: Any
) -> None:
    port = _loopback_port()
    source_id = uuid4()
    endpoint = f"modbus.tcp://127.0.0.1:{port}"
    device = ModbusDeviceContext(
        hr=ModbusSequentialDataBlock(1, [7, 0x4148, 0x0000])
    )
    server = asyncio.create_task(
        _serve(ModbusServerContext(devices={1: device}, single=False), port)
    )
    driver = ModbusTcpDriver(
        connection=DriverConnection(
            endpoint=endpoint,
            is_network_access_enabled=True,
            allowed_endpoints=frozenset({f"127.0.0.1:{port}"}),
        )
    )
    driver.load_points(
        [PointSpec("temperature", "holding:1:float32", 1000, "float")]
    )
    pipeline = _pipeline(
        redis_url, database, build_plan_view(_plan(source_id, endpoint))
    )
    sink = fan_out(
        pipeline.snapshots.sink_for(source_id),
        pipeline.archives.sink_for(source_id),
    )
    try:
        await asyncio.sleep(0.05)
        await driver.connect()
        value, ts_ms, quality = (await driver.read_many(["temperature"]))[0]
        assert (value, quality) == (12.5, "good")
        sink("temperature", value, ts_ms, quality)
        await pipeline.snapshots.flush_once()
        await pipeline.archives.flush_once()
        await pipeline.writer.flush_once()
        await _assert_value(pipeline, database, source_id, ts_ms)
    finally:
        await driver.disconnect()
        await modbus_server.ServerAsyncStop()
        await server
        await _cleanup(pipeline, database, source_id)
