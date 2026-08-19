"""守快照缓冲：窗内后值覆盖前值、原子交换不丢帧、写失败不回抛热路径。

⚠ 快照写失败是降级、采集断了才是事故（COLLECT_DESIGN.md §4.3）。
"""

import asyncio
import json
from collections.abc import Mapping, Sequence
from typing import Any
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
    """第一次写就以**非** AppError 炸掉，之后正常。

    ⚠ Redis 客户端不只抛 RedisError：连接池用坏、回包形状不对都是别的类型，
    而那类异常一旦逃出 flush，整条快照循环就此停摆而进程仍然绿着。
    """

    def __init__(self) -> None:
        self.writes: list[tuple[UUID, dict[str, str]]] = []
        self.touched: list[UUID] = []
        self.ttl_s = 0
        self.exploded = asyncio.Event()
        self.settled = asyncio.Event()

    async def write_many(
        self, batch: Mapping[UUID, Mapping[str, str]], *, ttl_s: int
    ) -> None:
        if not self.exploded.is_set():
            self.exploded.set()
            raise RuntimeError("Redis 客户端炸了")
        self.ttl_s = ttl_s
        for source_id, fields in batch.items():
            self.writes.append((source_id, dict(fields)))
        self.settled.set()

    async def touch(self, source_ids: Sequence[UUID], *, ttl_s: int) -> None:
        self.ttl_s = ttl_s
        self.touched.extend(source_ids)


class RecordingStore:
    """记下每一次写入的假快照面。"""

    def __init__(
        self,
        *,
        failures: int = 0,
        drop_failures: int = 0,
        touch_failures: int = 0,
    ) -> None:
        self.writes: list[tuple[UUID, dict[str, str]]] = []
        # 每一拍写出去的是哪一批。批数 = 这一拍打了几次 Redis
        self.batches: list[tuple[UUID, ...]] = []
        self.dropped: list[UUID] = []
        self.touched: list[tuple[UUID, ...]] = []
        self.failures = failures
        self.drop_failures = drop_failures
        self.touch_failures = touch_failures

    async def write_many(
        self, batch: Mapping[UUID, Mapping[str, str]], *, ttl_s: int
    ) -> None:
        if self.failures > 0:
            self.failures -= 1
            raise DependencyUnavailable("缓存服务暂时不可用")
        self.ttl_s = ttl_s
        # 一批一个往返，但仍按数据源逐条记下来：断言看的是「写了什么」
        self.batches.append(tuple(batch))
        for source_id, fields in batch.items():
            self.writes.append((source_id, dict(fields)))

    async def touch(self, source_ids: Sequence[UUID], *, ttl_s: int) -> None:
        if self.touch_failures > 0:
            self.touch_failures -= 1
            raise RuntimeError("Redis 客户端炸了")
        self.ttl_s = ttl_s
        self.touched.append(tuple(source_ids))

    async def drop(self, source_id: UUID) -> None:
        if self.drop_failures > 0:
            self.drop_failures -= 1
            raise DependencyUnavailable("缓存服务暂时不可用")
        self.dropped.append(source_id)

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        return None


class BlockingStore:
    """写入会卡在半路的假快照面，用来看清删键与写键的先后。"""

    def __init__(self) -> None:
        self.calls: list[tuple[str, UUID]] = []
        self.written: dict[str, str] = {}
        self.ttl_s = 0
        self.entered = asyncio.Event()
        self.released = asyncio.Event()

    @property
    def order(self) -> list[str]:
        """只看动作的先后，不看落在哪个数据源上。"""
        return [name for name, _ in self.calls]

    async def write_many(
        self, batch: Mapping[UUID, Mapping[str, str]], *, ttl_s: int
    ) -> None:
        self.entered.set()
        await self.released.wait()
        self.ttl_s = ttl_s
        for source_id, fields in batch.items():
            self.written = dict(fields)
            self.calls.append(("write", source_id))

    async def touch(self, source_ids: Sequence[UUID], *, ttl_s: int) -> None:
        self.ttl_s = ttl_s
        self.calls.extend(("touch", source_id) for source_id in source_ids)

    async def drop(self, source_id: UUID) -> None:
        self.calls.append(("drop", source_id))

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


async def test_one_flush_writes_one_batch_whatever_the_source_count() -> None:
    """一拍一个往返，与数据源数无关。

    ⚠ 按数据源逐个 `await` 就是串行等回包：窗口默认 300ms，而数据源数是现场
    给的——这条断言把「一拍打几次 Redis」钉住。
    """
    store = RecordingStore()
    sink = SnapshotSink(store=store, interval_ms=50, ttl_s=60)
    first, second, third = uuid4(), uuid4(), uuid4()
    for source_id, code in ((first, "temp"), (second, "flow"), (third, "rpm")):
        sink.sink_for(source_id)(code, 1.0, TS_MS, "good")

    await sink.flush_once()

    assert len(store.batches) == 1
    assert set(store.batches[0]) == {first, second, third}


async def test_a_flush_with_nothing_to_write_touches_no_batch() -> None:
    # ⚠ 空批不许换成一次空的 MULTI/EXEC：那是白打一个往返
    store = RecordingStore()
    sink = SnapshotSink(store=store, interval_ms=50, ttl_s=60)
    sink.sink_for(uuid4())
    await sink.flush_once()
    assert store.batches == []


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


async def test_a_source_with_no_new_readings_keeps_its_snapshot_alive() -> None:
    store = RecordingStore()
    sink = SnapshotSink(store=store, interval_ms=50, ttl_s=60)
    source_id = uuid4()
    sink.sink_for(source_id)("temp", 1.0, TS_MS, "good")
    await sink.flush_once()
    # 值一天才变一次的点位，这一窗就是空的——没人续期它的快照就会到期消失
    await sink.flush_once()
    assert store.touched == [(source_id,)]


async def test_a_source_that_just_wrote_is_not_touched_again() -> None:
    store = RecordingStore()
    sink = SnapshotSink(store=store, interval_ms=50, ttl_s=60)
    sink.sink_for(uuid4())("temp", 1.0, TS_MS, "good")
    await sink.flush_once()
    # 写入自己就带了续期，再补一次 EXPIRE 是白跑一个往返
    assert store.touched == []


async def test_a_keepalive_failure_of_any_kind_never_kills_the_flush() -> None:
    store = RecordingStore(touch_failures=1)
    sink = SnapshotSink(store=store, interval_ms=50, ttl_s=60)
    first, second = uuid4(), uuid4()
    sink.sink_for(first)
    sink.sink_for(second)("temp", 1.0, TS_MS, "good")
    await sink.flush_once()
    assert [source_id for source_id, _ in store.writes] == [second]


async def test_a_source_that_left_the_plan_loses_its_snapshot(
    build_plan: Any, build_plan_view: Any
) -> None:
    store = RecordingStore()
    gone = uuid4()
    sink = SnapshotSink(
        store=store,
        interval_ms=50,
        ttl_s=60,
        plan=build_plan_view(build_plan()),
    )
    sink.sink_for(gone)("temp", 1.0, TS_MS, "good")
    await sink.flush_once()
    assert store.dropped == [gone]
    # 停采的读数不许再落一次：写回去等于让它再当一个 TTL 的实时值
    assert store.writes == []


async def test_a_source_still_in_the_plan_keeps_its_snapshot(
    build_plan: Any, build_plan_view: Any
) -> None:
    store = RecordingStore()
    plan = build_plan()
    sink = SnapshotSink(
        store=store, interval_ms=50, ttl_s=60, plan=build_plan_view(plan)
    )
    source_id = plan.sources[0].source_id
    sink.sink_for(source_id)("temp", 1.0, TS_MS, "good")
    await sink.flush_once()
    assert store.dropped == []
    assert [written for written, _ in store.writes] == [source_id]


async def test_without_a_plan_no_snapshot_is_cleared(
    build_plan_view: Any,
) -> None:
    store = RecordingStore()
    sink = SnapshotSink(
        store=store, interval_ms=50, ttl_s=60, plan=build_plan_view()
    )
    source_id = uuid4()
    sink.sink_for(source_id)("temp", 1.0, TS_MS, "good")
    await sink.flush_once()
    # 拉不到计划时「计划里没有它」说的是我们不知道，不是它不该被采
    assert store.dropped == []
    assert [written for written, _ in store.writes] == [source_id]


async def test_a_drop_never_lands_while_a_write_is_in_flight(
    build_plan: Any, build_plan_view: Any
) -> None:
    store = BlockingStore()
    plan = build_plan()
    view = build_plan_view(plan)
    sink = SnapshotSink(store=store, interval_ms=50, ttl_s=60, plan=view)
    sink.sink_for(plan.sources[0].source_id)("temp", 1.0, TS_MS, "good")
    writing = asyncio.create_task(sink.flush_once())
    await asyncio.wait_for(store.entered.wait(), timeout=WAIT_S)
    view.replace(build_plan(version="v2", sources=()))
    pruning = asyncio.create_task(sink.flush_once())
    store.released.set()
    await asyncio.gather(writing, pruning)
    # 反过来的话，删掉的键会被那次在途的写重新建出来
    assert store.order == ["write", "drop"]


async def test_a_snapshot_that_cannot_be_dropped_never_kills_the_flush(
    build_plan: Any, build_plan_view: Any
) -> None:
    store = RecordingStore(drop_failures=1)
    sink = SnapshotSink(
        store=store,
        interval_ms=50,
        ttl_s=60,
        plan=build_plan_view(build_plan()),
    )
    sink.sink_for(uuid4())("temp", 1.0, TS_MS, "good")
    await sink.flush_once()
    assert store.dropped == []


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
    assert sink._interval_s_now() == 0.05
