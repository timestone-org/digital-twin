"""守快照缓冲：窗内后值覆盖前值、原子交换不丢帧、写失败不回抛热路径。

⚠ 快照写失败是降级、采集断了才是事故（COLLECT_DESIGN.md §4.3）。
"""

import asyncio
import json
from collections.abc import Mapping
from uuid import UUID, uuid4

import pytest

from collector_server.apps.collect.runtime.sink import (
    SnapshotSink,
    ValueBuffer,
    encode_fields,
)
from lib.errors import DependencyUnavailable

TS_MS = 1_767_323_045_000
# 等一个事件的上限。周期是 50ms，慢机器上也够跑好几拍
WAIT_S = 5.0


class ExplodingStore:
    """第一次写就以**非** AppError 炸掉，之后正常。只有 write 会被用到。

    ⚠ Redis 客户端不只抛 RedisError：连接池用坏、回包形状不对都是别的类型，
    而那类异常一旦逃出 flush，整条快照循环就此停摆而进程仍然绿着。
    """

    def __init__(self) -> None:
        self.writes: list[tuple[UUID, dict[str, str]]] = []
        self.ttl_s = 0
        self.exploded = asyncio.Event()
        self.settled = asyncio.Event()

    async def write(
        self, source_id: UUID, fields: Mapping[str, str], *, ttl_s: int
    ) -> None:
        if not self.exploded.is_set():
            self.exploded.set()
            raise RuntimeError("Redis 客户端炸了")
        self.ttl_s = ttl_s
        self.writes.append((source_id, dict(fields)))
        self.settled.set()


class RecordingStore:
    """记下每一次写入的假快照面。"""

    def __init__(self, *, failures: int = 0) -> None:
        self.writes: list[tuple[UUID, dict[str, str]]] = []
        self.dropped: list[UUID] = []
        self.failures = failures

    async def write(
        self, source_id: UUID, fields: Mapping[str, str], *, ttl_s: int
    ) -> None:
        if self.failures > 0:
            self.failures -= 1
            raise DependencyUnavailable("缓存服务暂时不可用")
        self.ttl_s = ttl_s
        self.writes.append((source_id, dict(fields)))

    async def drop(self, source_id: UUID) -> None:
        self.dropped.append(source_id)

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        return None


def test_later_value_wins_inside_one_window() -> None:
    buffer = ValueBuffer()
    buffer.record("temp", 1.0, TS_MS, "good")
    buffer.record("temp", 2.0, TS_MS + 10, "good")
    assert buffer.swap() == {"temp": (2.0, TS_MS + 10, "good")}


def test_swap_leaves_an_empty_window_behind() -> None:
    buffer = ValueBuffer()
    buffer.record("temp", 1.0, TS_MS, "good")
    buffer.swap()
    assert buffer.swap() == {}


def test_buffer_size_counts_points_not_readings() -> None:
    buffer = ValueBuffer()
    buffer.record("temp", 1.0, TS_MS, "good")
    buffer.record("temp", 2.0, TS_MS, "good")
    buffer.record("flow", 3.0, TS_MS, "bad")
    assert buffer.size() == 2


def test_encoded_field_carries_value_time_and_quality() -> None:
    encoded = encode_fields({"temp": (21.5, TS_MS, "uncertain")})
    assert json.loads(encoded["temp"]) == {
        "value": 21.5,
        "ts_ms": TS_MS,
        "quality": "uncertain",
    }


def test_unserializable_value_falls_back_to_text() -> None:
    encoded = encode_fields({"temp": (object(), TS_MS, "good")})
    assert json.loads(encoded["temp"])["value"].startswith("<object object")


async def test_flush_writes_every_source_that_has_readings() -> None:
    store = RecordingStore()
    sink = SnapshotSink(store=store, interval_ms=50, ttl_s=60)
    first, second = uuid4(), uuid4()
    sink.sink_for(first)("temp", 1.0, TS_MS, "good")
    sink.sink_for(second)("flow", 2.0, TS_MS, "good")
    await sink.flush_once()
    assert sorted(source_id for source_id, _ in store.writes) == sorted(
        [first, second]
    )


async def test_flush_skips_sources_without_new_readings() -> None:
    store = RecordingStore()
    sink = SnapshotSink(store=store, interval_ms=50, ttl_s=60)
    sink.sink_for(uuid4())
    await sink.flush_once()
    assert store.writes == []


async def test_write_failure_is_counted_and_never_reaches_the_caller() -> None:
    store = RecordingStore(failures=1)
    sink = SnapshotSink(store=store, interval_ms=50, ttl_s=60)
    sink.sink_for(uuid4())("temp", 1.0, TS_MS, "good")
    await sink.flush_once()
    assert sink.dropped == 1


async def test_stop_flushes_the_tail_frame() -> None:
    store = RecordingStore()
    sink = SnapshotSink(store=store, interval_ms=10_000, ttl_s=60)
    source_id = uuid4()
    await sink.start()
    sink.sink_for(source_id)("temp", 9.0, TS_MS, "good")
    await sink.stop()
    assert store.writes[-1][0] == source_id


async def test_forgetting_a_source_drops_its_snapshot() -> None:
    store = RecordingStore()
    sink = SnapshotSink(store=store, interval_ms=50, ttl_s=60)
    source_id = uuid4()
    sink.sink_for(source_id)("temp", 1.0, TS_MS, "good")
    await sink.forget(source_id)
    await sink.flush_once()
    assert store.dropped == [source_id]
    assert store.writes == []


async def test_a_write_failure_of_any_kind_is_counted_and_keeps_the_loop() -> (
    None
):
    store = ExplodingStore()
    sink = SnapshotSink(store=store, interval_ms=50, ttl_s=60)
    source_id = uuid4()
    await sink.start()
    try:
        sink.sink_for(source_id)("temp", 1.0, TS_MS, "good")
        await asyncio.wait_for(store.exploded.wait(), timeout=WAIT_S)
        sink.sink_for(source_id)("temp", 2.0, TS_MS + 1, "good")
        # 循环被第一拍带走的话，这一拍永远不会来
        await asyncio.wait_for(store.settled.wait(), timeout=WAIT_S)
    finally:
        await sink.stop()
    assert sink.dropped == 1
    assert [
        json.loads(fields["temp"])["value"] for _, fields in store.writes
    ] == [2.0]


@pytest.mark.parametrize("interval_ms", [0, 1], ids=["zero", "one"])
def test_flush_interval_never_goes_below_the_floor(interval_ms: int) -> None:
    sink = SnapshotSink(
        store=RecordingStore(), interval_ms=interval_ms, ttl_s=60
    )
    # 周期下限没有公开面，只能读内部
    assert sink._interval_s == 0.05
