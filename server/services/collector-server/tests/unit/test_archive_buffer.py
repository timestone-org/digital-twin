"""守归档缓冲的两件事：有界丢弃与落 Stream 的分批。

准入规则在 test_archive_admission.py，心跳补发在 test_archive_heartbeat.py。
"""

import asyncio
from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID, uuid4

from collector_server.apps.collect.archive.buffer import (
    ArchiveBuffer,
    ArchiveOptions,
    ArchiveRow,
)
from lib.errors import DependencyUnavailable

SOURCE_ID = UUID("0192f000-0000-7000-8000-000000000001")
TS_MS = 1_767_323_045_000
# 等一个事件的上限。周期是 50ms，慢机器上也够跑好几拍
WAIT_S = 5.0


class ExplodingStream:
    """第一次 append 就以**非** AppError 炸掉，之后正常。只有 append 会被用到。

    ⚠ Redis 客户端不只抛 RedisError：连接池用坏、回包形状不对都是别的类型，
    而那类异常一旦逃出 flush，整条归档循环就此停摆而进程仍然绿着。
    """

    def __init__(self) -> None:
        self.appended: list[list[Mapping[str, object]]] = []
        self.exploded = asyncio.Event()
        self.settled = asyncio.Event()

    async def append(
        self,
        _source_id: UUID,
        rows: Sequence[Mapping[str, object]],
        *,
        maxlen: int,
    ) -> int:
        if not self.exploded.is_set():
            self.exploded.set()
            raise RuntimeError("Redis 客户端炸了")
        self.appended.append(list(rows))
        self.settled.set()
        return maxlen - 1


def make_options(**overrides: int) -> ArchiveOptions:
    """一份默认宽松的缓冲配置。

    Args: **overrides。
    """
    fields: dict[str, int] = {
        "flush_interval_ms": 300,
        "max_rows": 100,
        "batch_rows": 10,
        "stream_maxlen": 1000,
    }
    fields.update(overrides)
    return ArchiveOptions(**fields)


async def test_a_point_the_plan_switched_off_is_kept_out_of_the_buffer(
    archive_stream: Any,
    build_plan_view: Any,
    build_plan: Any,
    build_source: Any,
    build_point: Any,
) -> None:
    plan = build_plan(
        sources=(
            build_source(
                points=(build_point("outlet_temp", archive_enabled=False),)
            ),
        )
    )
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(plan),
        options=make_options(),
    )
    await buffer.flush_once()
    buffer.sink_for(SOURCE_ID)("outlet_temp", 21.5, TS_MS, "good")
    assert buffer.pending == 0


async def test_the_buffer_drops_the_oldest_row_when_it_is_full(
    archive_stream: Any, build_plan_view: Any
) -> None:
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(),
        options=make_options(max_rows=2),
    )
    sink = buffer.sink_for(SOURCE_ID)
    for step in range(3):
        sink("outlet_temp", float(step), TS_MS + step, "good")
    await buffer.flush_once()
    assert [row["value"] for row in archive_stream.appended[0][1]] == [1.0, 2.0]


def test_dropping_rows_is_counted_not_silent(
    archive_stream: Any, build_plan_view: Any
) -> None:
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(),
        options=make_options(max_rows=1),
    )
    sink = buffer.sink_for(SOURCE_ID)
    for step in range(4):
        sink("outlet_temp", float(step), TS_MS + step, "good")
    assert (buffer.dropped, buffer.overflowed) == (3, 3)


async def test_rows_are_grouped_into_one_stream_per_source(
    archive_stream: Any, build_plan_view: Any
) -> None:
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(),
        options=make_options(),
    )
    other_id = uuid4()
    buffer.sink_for(SOURCE_ID)("outlet_temp", 1.0, TS_MS, "good")
    buffer.sink_for(other_id)("outlet_temp", 2.0, TS_MS, "good")
    await buffer.flush_once()
    assert [source for source, _ in archive_stream.appended] == [
        SOURCE_ID,
        other_id,
    ]


async def test_a_window_larger_than_the_batch_becomes_several_entries(
    archive_stream: Any, build_plan_view: Any
) -> None:
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(),
        options=make_options(batch_rows=2),
    )
    sink = buffer.sink_for(SOURCE_ID)
    for step in range(5):
        sink("outlet_temp", float(step), TS_MS + step, "good")
    await buffer.flush_once()
    assert [len(rows) for _, rows in archive_stream.appended] == [2, 2, 1]


async def test_a_stream_failure_never_reaches_the_collecting_path(
    archive_stream: Any, build_plan_view: Any
) -> None:
    archive_stream.append_error = DependencyUnavailable("缓存服务暂时不可用")
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(),
        options=make_options(),
    )
    buffer.sink_for(SOURCE_ID)("outlet_temp", 1.0, TS_MS, "good")
    await buffer.flush_once()
    assert buffer.dropped == 1


async def test_every_row_a_failed_append_gives_up_on_is_counted(
    archive_stream: Any, build_plan_view: Any
) -> None:
    archive_stream.append_error = DependencyUnavailable("缓存服务暂时不可用")
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(),
        options=make_options(batch_rows=2),
    )
    sink = buffer.sink_for(SOURCE_ID)
    for step in range(5):
        sink("outlet_temp", float(step), TS_MS + step, "good")
    await buffer.flush_once()
    assert (buffer.dropped, buffer.overflowed) == (5, 0)


async def test_the_window_is_emptied_by_a_flush(
    archive_stream: Any, build_plan_view: Any
) -> None:
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(),
        options=make_options(),
    )
    buffer.sink_for(SOURCE_ID)("outlet_temp", 1.0, TS_MS, "good")
    await buffer.flush_once()
    assert buffer.pending == 0


async def test_the_stream_bound_travels_with_every_append(
    archive_stream: Any, build_plan_view: Any
) -> None:
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(),
        options=make_options(stream_maxlen=7),
    )
    buffer.sink_for(SOURCE_ID)("outlet_temp", 1.0, TS_MS, "good")
    await buffer.flush_once()
    assert archive_stream.maxlens == [7]


async def test_a_new_plan_version_rebuilds_the_admission_table(
    archive_stream: Any,
    build_plan_view: Any,
    build_plan: Any,
    build_source: Any,
    build_point: Any,
) -> None:
    plan_view = build_plan_view(
        build_plan(
            sources=(build_source(points=(build_point("outlet_temp"),)),)
        )
    )
    buffer = ArchiveBuffer(
        stream=archive_stream, plan=plan_view, options=make_options()
    )
    await buffer.flush_once()
    plan_view.replace(
        build_plan(
            version="v2",
            sources=(
                build_source(
                    points=(build_point("outlet_temp", archive_enabled=False),)
                ),
            ),
        )
    )
    await buffer.flush_once()
    buffer.sink_for(SOURCE_ID)("outlet_temp", 1.0, TS_MS, "good")
    assert buffer.pending == 0


async def test_a_full_stream_is_reported_without_stopping_the_flush(
    archive_stream: Any, build_plan_view: Any
) -> None:
    archive_stream.length = 7
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(),
        options=make_options(stream_maxlen=7),
    )
    buffer.sink_for(SOURCE_ID)("outlet_temp", 1.0, TS_MS, "good")
    await buffer.flush_once()
    assert (buffer.dropped, len(archive_stream.appended)) == (0, 1)


async def test_the_tail_frame_is_flushed_when_the_buffer_stops(
    archive_stream: Any, build_plan_view: Any
) -> None:
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(),
        options=make_options(flush_interval_ms=60_000),
    )
    await buffer.start()
    buffer.sink_for(SOURCE_ID)("outlet_temp", 1.0, TS_MS, "good")
    await buffer.stop()
    assert len(archive_stream.appended) == 1


async def test_a_flush_failure_of_any_kind_is_counted_and_keeps_the_loop(
    build_plan_view: Any,
) -> None:
    stream = ExplodingStream()
    buffer = ArchiveBuffer(
        stream=stream,
        plan=build_plan_view(),
        options=make_options(flush_interval_ms=50),
    )
    await buffer.start()
    try:
        buffer.sink_for(SOURCE_ID)("outlet_temp", 1.0, TS_MS, "good")
        await asyncio.wait_for(stream.exploded.wait(), timeout=WAIT_S)
        buffer.sink_for(SOURCE_ID)("outlet_temp", 2.0, TS_MS + 1, "good")
        # 循环被第一拍带走的话，这一拍永远不会来
        await asyncio.wait_for(stream.settled.wait(), timeout=WAIT_S)
    finally:
        await buffer.stop()
    assert (buffer.dropped, buffer.overflowed) == (1, 0)
    assert [row["value"] for rows in stream.appended for row in rows] == [2.0]


def test_the_row_payload_shape_is_the_writer_contract() -> None:
    row = ArchiveRow(
        point_code="outlet_temp", value=21.5, ts_ms=TS_MS, quality="good"
    )
    assert row.to_payload() == {
        "point_code": "outlet_temp",
        "value": 21.5,
        "ts_ms": TS_MS,
        "quality": "good",
    }
