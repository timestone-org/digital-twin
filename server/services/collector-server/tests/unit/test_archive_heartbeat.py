"""守心跳补发：订阅着却一直不变的点位，归档缓冲要主动替它补行。

⚠ 订阅只在值变了才回调，准入里「心跳到期」那条对稳定的点位永远等不到；
不补的话它在库里就是几个月一行，台账任何按桶的口径都取不到它
（COLLECT_DESIGN.md §4.3 ③'）。
"""

from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

import pytest

from collector_server.apps.collect.archive.buffer import (
    ArchiveBuffer,
    ArchiveOptions,
)

SOURCE_ID = UUID("0192f000-0000-7000-8000-000000000001")
TS_MS = 1_767_323_045_000
# 心跳周期。⚠ 取得比扫描周期宽：用例里的每一次拨钟都同时跨过两道门槛
HEARTBEAT_MS = 2_000
OPTIONS = ArchiveOptions(
    flush_interval_ms=300, max_rows=100, batch_rows=10, stream_maxlen=1000
)


class FakeClock:
    """可拨的时钟。"""

    def __init__(self, now_ms: int) -> None:
        self.now_ms = now_ms

    def __call__(self) -> int:
        return self.now_ms

    def advance(self, delta_ms: int) -> None:
        """往前拨。

        Args: delta_ms。
        """
        self.now_ms += delta_ms


class FakeLiveness:
    """`SourceLiveness` 的假件：两个集合，订阅着的数据源一定也在线。"""

    def __init__(
        self,
        *,
        subscribing: Sequence[UUID] = (),
        polling: Sequence[UUID] = (),
    ) -> None:
        self.subscribing = set(subscribing)
        self.online = set(subscribing) | set(polling)

    def is_online(self, source_id: UUID) -> bool:
        return source_id in self.online

    def is_subscribing(self, source_id: UUID) -> bool:
        return source_id in self.subscribing

    def go_offline(self, source_id: UUID) -> None:
        """让一个数据源掉线。

        Args: source_id。
        """
        self.online.discard(source_id)
        self.subscribing.discard(source_id)

    def come_back(self, source_id: UUID) -> None:
        """让一个数据源以订阅方式重新连上。

        Args: source_id。
        """
        self.online.add(source_id)
        self.subscribing.add(source_id)


def _subscribing(*source_ids: UUID) -> FakeLiveness:
    """在线且订阅着这些数据源的假件。

    Args: *source_ids。
    """
    return FakeLiveness(subscribing=source_ids)


def _payloads(archive_stream: Any) -> list[Mapping[str, object]]:
    """按顺序摊平推进流里的全部行。

    Args: archive_stream。
    """
    return [row for _, rows in archive_stream.appended for row in rows]


def _row(value: object, ts_ms: int, quality: str = "good") -> dict[str, object]:
    """`outlet_temp` 的一行载荷。

    Args: value, ts_ms, quality。
    """
    return {
        "point_code": "outlet_temp",
        "value": value,
        "ts_ms": ts_ms,
        "quality": quality,
    }


@pytest.fixture
def build_heartbeat_buffer(
    archive_stream: Any,
    build_plan_view: Any,
    build_plan: Any,
    build_source: Any,
    build_point: Any,
) -> Any:
    """造一个绑了时钟与在线面、点位配了心跳的缓冲，策略表已按计划建好。"""

    async def build(
        clock: FakeClock,
        liveness: FakeLiveness | None,
        **point_overrides: object,
    ) -> ArchiveBuffer:
        fields: dict[str, object] = {"archive_max_interval_ms": HEARTBEAT_MS}
        fields.update(point_overrides)
        plan = build_plan(
            sources=(
                build_source(points=(build_point("outlet_temp", **fields),)),
            )
        )
        buffer = ArchiveBuffer(
            stream=archive_stream,
            plan=build_plan_view(plan),
            options=OPTIONS,
            clock=clock,
        )
        if liveness is not None:
            buffer.bind_liveness(liveness)
        # 真进程里缓冲比会话先起、第一拍就建好策略表；不预热的话读数会按缺省
        # 策略（没有心跳）收进来
        await buffer.flush_once()
        return buffer

    return build


async def test_a_subscribed_point_that_never_changes_still_gets_heartbeat_rows(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    clock = FakeClock(TS_MS)
    buffer = await build_heartbeat_buffer(clock, _subscribing(SOURCE_ID))
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert _payloads(archive_stream) == [
        _row(21.5, TS_MS),
        _row(21.5, TS_MS + HEARTBEAT_MS),
    ]


async def test_heartbeats_are_counted(build_heartbeat_buffer: Any) -> None:
    clock = FakeClock(TS_MS)
    buffer = await build_heartbeat_buffer(clock, _subscribing(SOURCE_ID))
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert buffer.heartbeats == 1


async def test_a_source_that_is_not_subscribing_gets_no_heartbeat(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    clock = FakeClock(TS_MS)
    buffer = await build_heartbeat_buffer(clock, FakeLiveness())
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert _payloads(archive_stream) == [_row(21.5, TS_MS)]


async def test_without_a_liveness_face_nothing_is_ever_made_up(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    clock = FakeClock(TS_MS)
    buffer = await build_heartbeat_buffer(clock, None)
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert _payloads(archive_stream) == [_row(21.5, TS_MS)]


async def test_a_point_without_a_heartbeat_is_left_alone(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    clock = FakeClock(TS_MS)
    buffer = await build_heartbeat_buffer(
        clock, _subscribing(SOURCE_ID), archive_max_interval_ms=0
    )
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS * 10)
    await buffer.flush_once()
    assert _payloads(archive_stream) == [_row(21.5, TS_MS)]


async def test_the_heartbeat_keeps_the_device_clock_of_the_last_reading(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    # 本地时钟比设备快 800ms：心跳的时刻要跟着设备走，否则它会排到下一条
    # 实测读数之后，台账取末值就取到这条陈值
    clock = FakeClock(TS_MS + 800)
    buffer = await build_heartbeat_buffer(clock, _subscribing(SOURCE_ID))
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert _payloads(archive_stream)[-1] == _row(21.5, TS_MS + HEARTBEAT_MS)


async def test_a_stale_initial_value_anchors_the_grid_on_the_local_clock(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    # 订阅的初值带的是上一次变化的时刻（三天前）：从它外推的心跳会整批落进
    # 过去、与旧行撞主键而静默丢掉，于是当下这一分钟仍然一行都没有
    three_days_ms = 3 * 86_400_000
    clock = FakeClock(TS_MS + three_days_ms)
    buffer = await build_heartbeat_buffer(clock, _subscribing(SOURCE_ID))
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert _payloads(archive_stream)[-1] == _row(
        21.5, TS_MS + three_days_ms + HEARTBEAT_MS
    )


async def test_a_polling_source_is_neither_heartbeated_nor_forgotten(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    clock = FakeClock(TS_MS)
    liveness = FakeLiveness(polling=(SOURCE_ID,))
    buffer = await build_heartbeat_buffer(clock, liveness)
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert _payloads(archive_stream) == [_row(21.5, TS_MS)]
    # 切成订阅之后不必再等一条读数：轮询期间「见过」的读数没有被忘掉
    liveness.come_back(SOURCE_ID)
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert _payloads(archive_stream)[-1] == _row(21.5, TS_MS + 2 * HEARTBEAT_MS)


async def test_the_heartbeat_carries_the_latest_reading_inside_the_deadband(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    clock = FakeClock(TS_MS)
    buffer = await build_heartbeat_buffer(
        clock, _subscribing(SOURCE_ID), deadband=0.5
    )
    sink = buffer.sink_for(SOURCE_ID)
    sink("outlet_temp", 21.5, TS_MS, "good")
    sink("outlet_temp", 21.8, TS_MS + 100, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert _payloads(archive_stream) == [
        _row(21.5, TS_MS),
        _row(21.8, TS_MS + HEARTBEAT_MS),
    ]


async def test_heartbeats_land_on_a_grid_from_the_last_real_reading(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    # 扫描有抖动：发出的时刻晚了几百毫秒，落下的时间戳仍在整格上，否则
    # 相邻两行的间隔会比心跳宽、隔一阵就漏掉一个台账桶
    clock = FakeClock(TS_MS)
    buffer = await build_heartbeat_buffer(clock, _subscribing(SOURCE_ID))
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS + 700)
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS + 600)
    await buffer.flush_once()
    assert [row["ts_ms"] for row in _payloads(archive_stream)] == [
        TS_MS,
        TS_MS + HEARTBEAT_MS,
        TS_MS + 2 * HEARTBEAT_MS,
    ]


async def test_a_long_stall_yields_the_latest_slot_only(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    clock = FakeClock(TS_MS)
    buffer = await build_heartbeat_buffer(clock, _subscribing(SOURCE_ID))
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    clock.advance(3 * HEARTBEAT_MS + 500)
    await buffer.flush_once()
    assert [row["ts_ms"] for row in _payloads(archive_stream)] == [
        TS_MS,
        TS_MS + 3 * HEARTBEAT_MS,
    ]


async def test_the_same_slot_is_never_sent_twice(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    clock = FakeClock(TS_MS)
    buffer = await build_heartbeat_buffer(clock, _subscribing(SOURCE_ID))
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS // 2)
    await buffer.flush_once()
    assert len(_payloads(archive_stream)) == 2


async def test_a_real_reading_restarts_the_heartbeat_grid(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    clock = FakeClock(TS_MS)
    buffer = await build_heartbeat_buffer(clock, _subscribing(SOURCE_ID))
    sink = buffer.sink_for(SOURCE_ID)
    sink("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    clock.advance(700)
    sink("outlet_temp", 25.0, TS_MS + 700, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert _payloads(archive_stream) == [
        _row(21.5, TS_MS),
        _row(25.0, TS_MS + 700),
        _row(25.0, TS_MS + 700 + HEARTBEAT_MS),
    ]


async def test_a_source_seen_offline_is_not_heartbeated_until_it_reads_again(
    build_heartbeat_buffer: Any, archive_stream: Any
) -> None:
    clock = FakeClock(TS_MS)
    liveness = _subscribing(SOURCE_ID)
    buffer = await build_heartbeat_buffer(clock, liveness)
    sink = buffer.sink_for(SOURCE_ID)
    sink("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    liveness.go_offline(SOURCE_ID)
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    # 重连上了，但订阅还没把初值推回来：谁也不知道现场的值还是不是 21.5
    liveness.come_back(SOURCE_ID)
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert _payloads(archive_stream) == [_row(21.5, TS_MS)]
    # 初值一到（离上一条已超过一个心跳，按准入本身就该收），网格从它重新起算
    sink("outlet_temp", 21.5, TS_MS + 2 * HEARTBEAT_MS, "good")
    await buffer.flush_once()
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert [row["ts_ms"] for row in _payloads(archive_stream)] == [
        TS_MS,
        TS_MS + 2 * HEARTBEAT_MS,
        TS_MS + 3 * HEARTBEAT_MS,
    ]


async def test_a_point_dropped_from_the_plan_stops_heartbeating(
    build_heartbeat_buffer: Any,
    archive_stream: Any,
    build_plan_view: Any,
    build_plan: Any,
    build_source: Any,
) -> None:
    clock = FakeClock(TS_MS)
    buffer = await build_heartbeat_buffer(clock, _subscribing(SOURCE_ID))
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    await buffer.flush_once()
    plan_view = buffer._plan  # pyright: ignore[reportPrivateUsage]
    assert isinstance(plan_view, build_plan_view)
    plan_view.replace(
        build_plan(version="v2", sources=(build_source(points=()),))
    )
    clock.advance(HEARTBEAT_MS)
    await buffer.flush_once()
    assert _payloads(archive_stream) == [_row(21.5, TS_MS)]
