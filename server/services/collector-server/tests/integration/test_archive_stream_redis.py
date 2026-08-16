"""守真 Redis 上的归档流：追加、按最旧读、删已落库的条目、上限裁剪。

⚠ 条目里必须带 traceparent，且 `MAXLEN ~` 裁掉的是**最旧**的条目——顶到上限
就等于在丢历史，所以长度要回给调用方去告警（COLLECT_DESIGN.md §4.3 ⑥）。
"""

import json
from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

import pytest
from redis.asyncio import Redis

from collector_server.stream import (
    ROWS_FIELD,
    RedisArchiveStream,
    stream_key,
)
from collectwire import TRACEPARENT_KEY

TS_MS = 1_767_323_045_000
MAXLEN = 1000
# 近似裁剪按节点边界走，所以只断言「远小于写入量」而不是精确条数
TRIM_TARGET = 5
TRIM_WRITES = 200


def rows(count: int) -> list[dict[str, object]]:
    """造 count 行载荷。

    Args: count。
    """
    return [
        {
            "point_code": f"point_{index}",
            "value": float(index),
            "ts_ms": TS_MS + index,
            "quality": "good",
        }
        for index in range(count)
    ]


@pytest.fixture
async def stream(redis_url: str) -> AsyncIterator[RedisArchiveStream]:
    """一条打真 Redis 的归档流。"""
    opened = RedisArchiveStream(url=redis_url)
    yield opened
    await opened.close()


@pytest.fixture
async def client(redis_url: str) -> AsyncIterator[Any]:
    """一个原生客户端，用来从旁边核对写进去的东西。"""
    opened = Redis.from_url(redis_url, decode_responses=True, socket_timeout=2)
    yield opened
    await opened.aclose()


async def test_a_batch_lands_as_one_entry_on_the_source_stream(
    stream: RedisArchiveStream, client: Any
) -> None:
    source_id = uuid4()
    try:
        await stream.append(source_id, rows(3), maxlen=MAXLEN)
        assert await client.xlen(stream_key(source_id)) == 1
    finally:
        await client.delete(stream_key(source_id))


async def test_the_entry_carries_the_trace_across_the_hop(
    stream: RedisArchiveStream, client: Any
) -> None:
    source_id = uuid4()
    try:
        await stream.append(source_id, rows(1), maxlen=MAXLEN)
        entries = await client.xrange(stream_key(source_id))
        assert TRACEPARENT_KEY in entries[0][1]
    finally:
        await client.delete(stream_key(source_id))


async def test_the_rows_survive_the_round_trip(
    stream: RedisArchiveStream, client: Any
) -> None:
    source_id = uuid4()
    try:
        await stream.append(source_id, rows(2), maxlen=MAXLEN)
        read = await stream.read(stream_key(source_id), count=10)
        assert [row["point_code"] for row in read[0].rows] == [
            "point_0",
            "point_1",
        ]
    finally:
        await client.delete(stream_key(source_id))


async def test_reading_starts_from_the_oldest_entry(
    stream: RedisArchiveStream, client: Any
) -> None:
    source_id = uuid4()
    try:
        await stream.append(source_id, [rows(1)[0]], maxlen=MAXLEN)
        await stream.append(source_id, [{"point_code": "later"}], maxlen=MAXLEN)
        read = await stream.read(stream_key(source_id), count=1)
        assert read[0].rows[0]["point_code"] == "point_0"
    finally:
        await client.delete(stream_key(source_id))


async def test_deleting_an_entry_leaves_the_untouched_ones(
    stream: RedisArchiveStream, client: Any
) -> None:
    source_id = uuid4()
    key = stream_key(source_id)
    try:
        await stream.append(source_id, rows(1), maxlen=MAXLEN)
        await stream.append(source_id, [{"point_code": "later"}], maxlen=MAXLEN)
        first = await stream.read(key, count=1)
        await stream.delete(key, [first[0].entry_id])
        remaining = await stream.read(key, count=10)
        assert [entry.rows[0]["point_code"] for entry in remaining] == ["later"]
    finally:
        await client.delete(key)


async def test_the_stream_length_comes_back_with_every_append(
    stream: RedisArchiveStream, client: Any
) -> None:
    source_id = uuid4()
    try:
        await stream.append(source_id, rows(1), maxlen=MAXLEN)
        assert await stream.append(source_id, rows(1), maxlen=MAXLEN) == 2
    finally:
        await client.delete(stream_key(source_id))


async def test_the_bound_keeps_a_stalled_stream_from_growing_forever(
    stream: RedisArchiveStream, client: Any
) -> None:
    source_id = uuid4()
    try:
        for _ in range(TRIM_WRITES):
            await stream.append(source_id, rows(1), maxlen=TRIM_TARGET)
        assert await client.xlen(stream_key(source_id)) < TRIM_WRITES
    finally:
        await client.delete(stream_key(source_id))


async def test_scanning_finds_the_streams_that_still_hold_rows(
    stream: RedisArchiveStream, client: Any
) -> None:
    source_id = uuid4()
    try:
        await stream.append(source_id, rows(1), maxlen=MAXLEN)
        assert stream_key(source_id) in await stream.keys()
    finally:
        await client.delete(stream_key(source_id))


async def test_an_entry_that_is_not_json_is_skipped_not_fatal(
    stream: RedisArchiveStream, client: Any
) -> None:
    source_id = uuid4()
    key = stream_key(source_id)
    try:
        await client.xadd(key, {ROWS_FIELD: "not-json"})
        await stream.append(source_id, rows(1), maxlen=MAXLEN)
        read = await stream.read(key, count=10)
        assert [len(entry.rows) for entry in read] == [0, 1]
    finally:
        await client.delete(key)


async def test_deleting_nothing_is_not_a_round_trip(
    stream: RedisArchiveStream,
) -> None:
    assert await stream.delete(stream_key(uuid4()), []) == 0


async def test_an_entry_without_the_rows_field_is_ignored(
    stream: RedisArchiveStream, client: Any
) -> None:
    source_id = uuid4()
    key = stream_key(source_id)
    try:
        await client.xadd(key, {"invented_later": json.dumps([])})
        assert await stream.read(key, count=10) == []
    finally:
        await client.delete(key)
