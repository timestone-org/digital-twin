"""历史读侧的分页与入参校验。

守的是「时序集合一律游标分页」与「时刻必须带时区」两条口径。
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from lib.web import CursorParams, decode_cursor, encode_cursor
from platform_server.apps.collect.errors import HistoryQueryInvalid
from platform_server.apps.collect.schemas import AggregateIn
from platform_server.apps.collect.services import history_service
from unit.collect_fakes import FakeHistorySource

SOURCE_ID = uuid.UUID("0192f0c0-0000-7000-8000-0000000000d1")
NODE_KEY = f"{SOURCE_ID}:outlet_temp"
RANGE_START = datetime(2026, 8, 1, tzinfo=UTC)
RANGE_END = datetime(2026, 8, 2, tzinfo=UTC)


def build_row(minute: int, value: float | None) -> dict[str, object]:
    """一行归档记录。

    Args: minute, value。
    """
    return {
        "source_id": SOURCE_ID,
        "point_code": "outlet_temp",
        "ts": datetime(2026, 8, 1, 0, minute, tzinfo=UTC),
        "value_num": value,
        "value_text": None,
        "quality": "good",
    }


def build_query() -> history_service.HistoryQuery:
    """一条一天区间、单点位的查询。"""
    return history_service.build_query(
        node_keys=[NODE_KEY],
        range_start=RANGE_START,
        range_end=RANGE_END,
    )


def test_an_empty_range_is_refused() -> None:
    with pytest.raises(HistoryQueryInvalid) as raised:
        history_service.build_query(
            node_keys=[NODE_KEY],
            range_start=RANGE_END,
            range_end=RANGE_START,
        )
    assert raised.value.details[0].field == "range_end"
    assert raised.value.details[0].code == "empty_range"


def test_a_malformed_node_key_points_at_its_position() -> None:
    with pytest.raises(HistoryQueryInvalid) as raised:
        history_service.build_query(
            node_keys=[NODE_KEY, "没有冒号"],
            range_start=RANGE_START,
            range_end=RANGE_END,
        )
    assert raised.value.details[0].field == "node_keys[1]"
    assert raised.value.details[0].code == "invalid_node_key"


def test_a_naive_moment_is_refused() -> None:
    with pytest.raises(HistoryQueryInvalid) as raised:
        history_service.parse_moment("2026-08-01T00:00:00", "range_start")
    assert raised.value.details[0].code == "missing_timezone"


def test_an_unparsable_moment_is_refused() -> None:
    with pytest.raises(HistoryQueryInvalid) as raised:
        history_service.parse_moment("昨天", "range_start")
    assert raised.value.details[0].code == "invalid_format"


def test_a_zulu_moment_parses_to_utc() -> None:
    moment = history_service.parse_moment("2026-08-01T00:00:00Z", "range_start")
    assert moment == RANGE_START


async def test_a_full_page_reports_more_and_hands_back_a_cursor() -> None:
    source = FakeHistorySource(
        rows=[build_row(index, 1.0) for index in range(3)]
    )
    page = await history_service.read_history(
        source, query=build_query(), page=CursorParams(limit=2, after=None)
    )
    assert len(page.items) == 2
    assert page.has_more is True
    assert page.next is not None
    anchor = decode_cursor(page.next)
    assert anchor["point_code"] == "outlet_temp"
    assert anchor["source_id"] == str(SOURCE_ID)
    assert anchor["ts"] == "2026-08-01T00:01:00+00:00"


async def test_a_short_page_has_no_cursor() -> None:
    source = FakeHistorySource(rows=[build_row(0, 1.0)])
    page = await history_service.read_history(
        source, query=build_query(), page=CursorParams(limit=5, after=None)
    )
    assert page.has_more is False
    assert page.next is None


async def test_the_page_asks_for_one_row_more_than_the_limit() -> None:
    source = FakeHistorySource(rows=[])
    await history_service.read_history(
        source, query=build_query(), page=CursorParams(limit=10, after=None)
    )
    assert source.last_params["row_limit"] == 11


async def test_a_cursor_is_carried_into_the_next_query() -> None:
    source = FakeHistorySource(
        rows=[build_row(index, 1.0) for index in range(3)]
    )
    first = await history_service.read_history(
        source, query=build_query(), page=CursorParams(limit=2, after=None)
    )
    assert first.next is not None
    await history_service.read_history(
        source,
        query=build_query(),
        page=CursorParams(limit=2, after=first.next),
    )
    assert source.last_params["after_point_code"] == "outlet_temp"


async def test_a_cursor_with_an_unreadable_moment_is_refused() -> None:
    # ⚠ 游标是客户端随手就能改的入参：解不动的时刻漏成异常就是一个 500，
    # 而它本该是一次 400
    forged = encode_cursor(
        {"ts": "昨天", "source_id": str(SOURCE_ID), "point_code": "outlet_temp"}
    )
    with pytest.raises(HistoryQueryInvalid) as raised:
        await history_service.read_history(
            FakeHistorySource(),
            query=build_query(),
            page=CursorParams(limit=2, after=forged),
        )
    assert raised.value.http_status == 400


async def test_a_text_value_round_trips_through_the_archive_columns() -> None:
    row = build_row(0, None)
    row["value_text"] = '{"mode": "auto"}'
    source = FakeHistorySource(rows=[row])
    page = await history_service.read_history(
        source, query=build_query(), page=CursorParams(limit=5, after=None)
    )
    assert page.items[0].value == {"mode": "auto"}


async def test_an_unknown_quality_reads_back_as_bad() -> None:
    row = build_row(0, 1.0)
    row["quality"] = "很好"
    source = FakeHistorySource(rows=[row])
    page = await history_service.read_history(
        source, query=build_query(), page=CursorParams(limit=5, after=None)
    )
    assert page.items[0].quality == "bad"


async def test_an_unsupported_aggregate_is_refused() -> None:
    payload = AggregateIn(
        node_keys=[NODE_KEY],
        range_start=RANGE_START,
        range_end=RANGE_END,
        interval="15m",
        aggregate="median",
    )
    with pytest.raises(HistoryQueryInvalid) as raised:
        await history_service.aggregate_history(
            FakeHistorySource(), payload=payload, default_timezone="UTC"
        )
    assert raised.value.details[0].field == "aggregate"


async def test_the_response_echoes_the_default_timezone() -> None:
    payload = AggregateIn(
        node_keys=[NODE_KEY],
        range_start=RANGE_START,
        range_end=RANGE_END,
        interval="1h",
    )
    result = await history_service.aggregate_history(
        FakeHistorySource(), payload=payload, default_timezone="Asia/Shanghai"
    )
    assert result.timezone == "Asia/Shanghai"
    assert result.interval == "1h"
    assert result.aggregate == "avg"


async def test_an_explicit_timezone_wins_over_the_default() -> None:
    payload = AggregateIn(
        node_keys=[NODE_KEY],
        range_start=RANGE_START,
        range_end=RANGE_END,
        interval="1d",
        timezone="UTC",
    )
    source = FakeHistorySource()
    result = await history_service.aggregate_history(
        source, payload=payload, default_timezone="Asia/Shanghai"
    )
    assert result.timezone == "UTC"
    assert source.last_params["bucket_timezone"] == "UTC"


async def test_the_window_suffix_becomes_a_postgres_interval() -> None:
    source = FakeHistorySource()
    for interval, expected in (
        ("30s", timedelta(seconds=30)),
        ("15m", timedelta(minutes=15)),
        ("2h", timedelta(hours=2)),
        ("1d", timedelta(days=1)),
    ):
        payload = AggregateIn(
            node_keys=[NODE_KEY],
            range_start=RANGE_START,
            range_end=RANGE_END,
            interval=interval,
        )
        await history_service.aggregate_history(
            source, payload=payload, default_timezone="UTC"
        )
        assert source.last_params["bucket_width"] == expected


async def test_a_bucket_row_maps_into_the_public_shape() -> None:
    source = FakeHistorySource(
        rows=[
            {
                "source_id": SOURCE_ID,
                "point_code": "outlet_temp",
                "bucket_start": datetime(2026, 8, 1, tzinfo=UTC),
                "bucket_value": 21.5,
                "sample_count": 60,
            }
        ]
    )
    payload = AggregateIn(
        node_keys=[NODE_KEY],
        range_start=RANGE_START,
        range_end=RANGE_END,
        interval="1h",
    )
    result = await history_service.aggregate_history(
        source, payload=payload, default_timezone="UTC"
    )
    assert result.items[0].node_key == NODE_KEY
    assert result.items[0].value == 21.5
    assert result.items[0].sample_count == 60


async def test_a_bucket_with_no_samples_reads_back_as_null() -> None:
    source = FakeHistorySource(
        rows=[
            {
                "source_id": str(SOURCE_ID),
                "point_code": "outlet_temp",
                "bucket_start": "2026-08-01T00:00:00+00:00",
                "bucket_value": None,
                "sample_count": 0,
            }
        ]
    )
    payload = AggregateIn(
        node_keys=[NODE_KEY],
        range_start=RANGE_START,
        range_end=RANGE_END,
        interval="1h",
    )
    result = await history_service.aggregate_history(
        source, payload=payload, default_timezone="UTC"
    )
    assert result.items[0].value is None
