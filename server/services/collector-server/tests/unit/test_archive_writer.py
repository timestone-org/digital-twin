"""守落库端的顺序与降级：先写库成功才 XDEL，任何一步失败都不许抛进采集。

⚠ 顺序反了会在库写失败时丢数据；而一条解不开的行若留在流里，会把这个数据源
之后的历史全部堵死（COLLECT_DESIGN.md §4.3 ⑦）。
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest

from collector_server.apps.collect.archive.writer import (
    MAX_ROUNDS_PER_FLUSH,
    ArchiveWriter,
    WriterOptions,
    to_row,
)
from collector_server.stream import StreamEntry, stream_key
from lib.errors import DependencyUnavailable

SOURCE_ID = UUID("0192f000-0000-7000-8000-000000000001")
TS_MS = 1_767_323_045_000
LONG_INTERVAL_MS = 60_000
# 公元 33658 年，超出 datetime 的值域
OUT_OF_RANGE_TS_MS = 10**15


class EndlessStream:
    """永远还有下一批的流：删了也照样读得到，用来试探单轮的预算。"""

    def __init__(self) -> None:
        self.reads = 0
        self.deleted: list[str] = []

    async def keys(self) -> list[str]:
        return [stream_key(SOURCE_ID)]

    async def read(self, key: str, *, count: int) -> list[StreamEntry]:
        self.reads += 1
        entry = StreamEntry(entry_id=f"{key}-{self.reads}", rows=(payload(),))
        return [entry][:count]

    async def delete(self, key: str, entry_ids: Sequence[str]) -> int:
        self.deleted.append(key)
        return len(entry_ids)


def make_writer(stream: Any, store: Any) -> ArchiveWriter:
    """一个不会自己跑循环的 writer。

    Args: stream, store。
    """
    return ArchiveWriter(
        stream=stream,
        store=store,
        options=WriterOptions(flush_interval_ms=LONG_INTERVAL_MS),
    )


def payload(**overrides: object) -> dict[str, object]:
    """一行完整的 Stream 载荷。

    Args: **overrides。
    """
    row: dict[str, object] = {
        "point_code": "outlet_temp",
        "value": 21.5,
        "ts_ms": TS_MS,
        "quality": "good",
    }
    row.update(overrides)
    return row


def test_a_row_carries_the_source_from_the_stream_key() -> None:
    row = to_row(SOURCE_ID, payload())
    assert row is not None
    assert row["source_id"] == SOURCE_ID


def test_the_timestamp_lands_as_utc() -> None:
    row = to_row(SOURCE_ID, payload(ts_ms=0))
    assert row is not None
    assert row["ts"] == datetime(1970, 1, 1, tzinfo=UTC)


def test_a_numeric_value_goes_to_the_number_column() -> None:
    row = to_row(SOURCE_ID, payload(value=21.5))
    assert row is not None
    assert (row["value_num"], row["value_text"]) == (21.5, None)


def test_a_structured_value_goes_to_the_text_column() -> None:
    row = to_row(SOURCE_ID, payload(value=["a", 1]))
    assert row is not None
    assert (row["value_num"], row["value_text"]) == (None, '["a", 1]')


def test_a_null_reading_keeps_only_the_time_and_quality() -> None:
    row = to_row(SOURCE_ID, payload(value=None, quality="bad"))
    assert row is not None
    assert (row["value_num"], row["value_text"], row["quality"]) == (
        None,
        None,
        "bad",
    )


def test_an_unknown_quality_word_is_read_as_bad() -> None:
    row = to_row(SOURCE_ID, payload(quality="excellent"))
    assert row is not None
    assert row["quality"] == "bad"


def test_a_row_without_a_point_code_is_refused() -> None:
    assert to_row(SOURCE_ID, payload(point_code="")) is None


def test_a_row_whose_time_is_a_boolean_is_refused() -> None:
    assert to_row(SOURCE_ID, payload(ts_ms=True)) is None


def test_a_row_whose_time_is_missing_is_refused() -> None:
    assert to_row(SOURCE_ID, {"point_code": "outlet_temp"}) is None


@pytest.mark.parametrize(
    "ts_ms", [OUT_OF_RANGE_TS_MS, -OUT_OF_RANGE_TS_MS], ids=["future", "past"]
)
def test_a_row_whose_time_is_outside_the_calendar_is_refused(
    ts_ms: int,
) -> None:
    # 现场时钟坏掉时回来的毫秒数能落到公元 3 万年，那超出 datetime 的值域
    assert to_row(SOURCE_ID, payload(ts_ms=ts_ms)) is None


async def test_an_impossible_time_does_not_block_the_whole_stream(
    archive_stream: Any, history_store: Any
) -> None:
    entry_id = archive_stream.load(
        SOURCE_ID, [payload(ts_ms=OUT_OF_RANGE_TS_MS), payload()]
    )
    writer = make_writer(archive_stream, history_store)
    await writer.flush_once()
    # 条目必须被删掉：留在流里，这个数据源之后的历史全部写不进去
    assert archive_stream.deleted == [(stream_key(SOURCE_ID), (entry_id,))]
    assert (writer.dropped, writer.written) == (1, 1)


async def test_entries_are_deleted_only_after_the_rows_are_stored(
    archive_stream: Any, history_store: Any
) -> None:
    entry_id = archive_stream.load(SOURCE_ID, [payload()])
    await make_writer(archive_stream, history_store).flush_once()
    assert archive_stream.deleted == [(stream_key(SOURCE_ID), (entry_id,))]


async def test_a_failed_write_leaves_the_entries_in_the_stream(
    archive_stream: Any, history_store: Any
) -> None:
    archive_stream.load(SOURCE_ID, [payload()])
    history_store.error = DependencyUnavailable("数据库暂时不可用")
    await make_writer(archive_stream, history_store).flush_once()
    assert archive_stream.deleted == []


async def test_a_failed_write_is_not_counted_as_written(
    archive_stream: Any, history_store: Any
) -> None:
    archive_stream.load(SOURCE_ID, [payload()])
    history_store.error = DependencyUnavailable("数据库暂时不可用")
    writer = make_writer(archive_stream, history_store)
    await writer.flush_once()
    assert writer.written == 0


async def test_a_stream_that_cannot_be_listed_only_skips_this_round(
    archive_stream: Any, history_store: Any
) -> None:
    archive_stream.keys_error = DependencyUnavailable("缓存服务暂时不可用")
    assert await make_writer(archive_stream, history_store).flush_once() == 0


async def test_a_read_failure_only_skips_this_round(
    archive_stream: Any, history_store: Any
) -> None:
    archive_stream.load(SOURCE_ID, [payload()])
    archive_stream.read_error = DependencyUnavailable("缓存服务暂时不可用")
    assert await make_writer(archive_stream, history_store).flush_once() == 0


async def test_a_broken_row_is_dropped_so_the_stream_keeps_moving(
    archive_stream: Any, history_store: Any
) -> None:
    archive_stream.load(SOURCE_ID, [payload(ts_ms="not-a-time"), payload()])
    writer = make_writer(archive_stream, history_store)
    await writer.flush_once()
    assert (writer.dropped, writer.written) == (1, 1)


async def test_a_key_that_is_not_ours_is_left_alone(
    archive_stream: Any, history_store: Any
) -> None:
    archive_stream.entries["collect:snapshot:not-a-stream"] = []
    assert await make_writer(archive_stream, history_store).flush_once() == 0


async def test_every_source_stream_is_drained_in_one_round(
    archive_stream: Any, history_store: Any
) -> None:
    other_id = UUID("0192f000-0000-7000-8000-000000000002")
    archive_stream.load(SOURCE_ID, [payload()])
    archive_stream.load(other_id, [payload()])
    assert await make_writer(archive_stream, history_store).flush_once() == 2


async def test_rows_reach_the_store_in_the_order_they_were_produced(
    archive_stream: Any, history_store: Any
) -> None:
    archive_stream.load(
        SOURCE_ID, [payload(value=1.0), payload(value=2.0, ts_ms=TS_MS + 1)]
    )
    await make_writer(archive_stream, history_store).flush_once()
    assert [row["value_num"] for row in history_store.rows] == [1.0, 2.0]


async def test_one_stream_cannot_hold_the_round_forever(
    history_store: Any,
) -> None:
    stream = EndlessStream()
    written = await make_writer(stream, history_store).flush_once()
    assert (stream.reads, written) == (
        MAX_ROUNDS_PER_FLUSH,
        MAX_ROUNDS_PER_FLUSH,
    )


async def test_the_stream_is_drained_when_the_writer_stops(
    archive_stream: Any, history_store: Any
) -> None:
    writer = make_writer(archive_stream, history_store)
    await writer.start()
    archive_stream.load(SOURCE_ID, [payload()])
    await writer.stop()
    assert writer.written == 1
