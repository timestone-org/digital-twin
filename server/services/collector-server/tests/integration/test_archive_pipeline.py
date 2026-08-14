"""守整条归档管道：ValueSink → 有界缓冲 → 真 Redis Stream → 真 TimescaleDB。

⚠ 顺序是「写库成功才删条目」：这一层要证明重投不会写重、且排干之后流是空的
（COLLECT_DESIGN.md §4.3 ⑦）。
"""

from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID, uuid4

import pytest
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
from collector_server.apps.collect.services import PointHistoryService
from collector_server.stream import RedisArchiveStream, stream_key
from lib.db import Database

pytestmark = pytest.mark.requires_postgres

TABLE = "collect.point_history"
TS_MS = 1_767_323_045_000
LONG_INTERVAL_MS = 60_000
OPTIONS = ArchiveOptions(
    flush_interval_ms=LONG_INTERVAL_MS,
    max_rows=100,
    batch_rows=10,
    stream_maxlen=1000,
)


@pytest.fixture
async def stream(redis_url: str) -> AsyncIterator[RedisArchiveStream]:
    """一条打真 Redis 的归档流。"""
    opened = RedisArchiveStream(url=redis_url)
    yield opened
    await opened.close()


@pytest.fixture
async def client(redis_url: str) -> AsyncIterator[Any]:
    """一个原生客户端，用来核对流是不是真的排干了。"""
    opened = Redis.from_url(redis_url, decode_responses=True, socket_timeout=2)
    yield opened
    await opened.aclose()


def make_writer(
    stream: RedisArchiveStream, database: Database
) -> ArchiveWriter:
    """打真库的落库端。

    Args: stream, database。
    """
    return ArchiveWriter(
        stream=stream,
        store=PointHistoryService(database=database, batch_rows=10),
        options=WriterOptions(flush_interval_ms=LONG_INTERVAL_MS),
    )


async def stored_values(database: Database, source_id: UUID) -> list[Any]:
    """取回一个数据源落库的读数。

    Args: database, source_id。
    """
    async with database.session() as session:
        result = await session.execute(
            text(
                f"SELECT value_num FROM {TABLE} "  # noqa: S608  # 表名是本文件的字面常量
                "WHERE source_id = :source_id ORDER BY ts"
            ),
            {"source_id": str(source_id)},
        )
        return [row[0] for row in result.all()]


async def cleanup(database: Database, client: Any, source_id: UUID) -> None:
    """删掉这一轮写进库与流里的东西。

    Args: database, client, source_id。
    """
    await client.delete(stream_key(source_id))
    async with database.session() as session:
        await session.execute(
            text(
                f"DELETE FROM {TABLE} WHERE source_id = :source_id"  # noqa: S608  # 同上
            ),
            {"source_id": str(source_id)},
        )


async def test_a_reading_travels_from_the_sink_all_the_way_into_the_table(
    stream: RedisArchiveStream,
    database: Database,
    client: Any,
    build_plan_view: Any,
) -> None:
    source_id = uuid4()
    buffer = ArchiveBuffer(
        stream=stream, plan=build_plan_view(), options=OPTIONS
    )
    try:
        buffer.sink_for(source_id)("outlet_temp", 21.5, TS_MS, "good")
        await buffer.flush_once()
        await make_writer(stream, database).flush_once()
        assert await stored_values(database, source_id) == [21.5]
    finally:
        await cleanup(database, client, source_id)


async def test_a_drained_stream_is_left_empty(
    stream: RedisArchiveStream,
    database: Database,
    client: Any,
    build_plan_view: Any,
) -> None:
    source_id = uuid4()
    buffer = ArchiveBuffer(
        stream=stream, plan=build_plan_view(), options=OPTIONS
    )
    try:
        buffer.sink_for(source_id)("outlet_temp", 21.5, TS_MS, "good")
        await buffer.flush_once()
        await make_writer(stream, database).flush_once()
        assert await client.xlen(stream_key(source_id)) == 0
    finally:
        await cleanup(database, client, source_id)


async def test_a_redelivered_batch_does_not_write_the_row_twice(
    stream: RedisArchiveStream,
    database: Database,
    client: Any,
) -> None:
    source_id = uuid4()
    row = {
        "point_code": "outlet_temp",
        "value": 21.5,
        "ts_ms": TS_MS,
        "quality": "good",
    }
    try:
        await stream.append(source_id, [row], maxlen=1000)
        await stream.append(source_id, [row], maxlen=1000)
        await make_writer(stream, database).flush_once()
        assert await stored_values(database, source_id) == [21.5]
    finally:
        await cleanup(database, client, source_id)


async def test_rows_left_by_a_previous_run_are_drained_on_the_next_pass(
    stream: RedisArchiveStream,
    database: Database,
    client: Any,
) -> None:
    source_id = uuid4()
    try:
        await stream.append(
            source_id,
            [
                {
                    "point_code": "outlet_temp",
                    "value": 7.5,
                    "ts_ms": TS_MS,
                    "quality": "good",
                }
            ],
            maxlen=1000,
        )
        writer = make_writer(stream, database)
        await writer.start()
        await writer.stop()
        assert await stored_values(database, source_id) == [7.5]
    finally:
        await cleanup(database, client, source_id)


async def test_the_admission_rule_keeps_a_held_value_out_of_the_table(
    stream: RedisArchiveStream,
    database: Database,
    client: Any,
    build_plan_view: Any,
) -> None:
    source_id = uuid4()
    buffer = ArchiveBuffer(
        stream=stream, plan=build_plan_view(), options=OPTIONS
    )
    try:
        sink = buffer.sink_for(source_id)
        sink("outlet_temp", 21.5, TS_MS, "good")
        sink("outlet_temp", 21.5, TS_MS + 1000, "good")
        await buffer.flush_once()
        await make_writer(stream, database).flush_once()
        assert await stored_values(database, source_id) == [21.5]
    finally:
        await cleanup(database, client, source_id)
