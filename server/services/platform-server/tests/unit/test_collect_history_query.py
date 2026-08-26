"""归档宽表查询的 SQL 契约。

守的是四条：跨 schema 只读且表名完全限定、值一律绑定参数、时刻与桶宽绑的是
`datetime` / `timedelta` 而不是它们的字符串形态、`time_bucket` 必须带
`timezone =>`（不带就按 UNIX 纪元对齐，日桶会偏 8 小时）。

⚠ 第三条看着像洁癖，其实是这一面唯一真会塌的地方：驱动按 `ts >= $n` 与
`CAST($n AS interval)` 的上下文把占位符认成 timestamptz 与 interval，喂字符串
是当场 DataError，于是整条读侧恒 503——而只断言 SQL 文本的用例全绿。
"""

import uuid
from datetime import UTC, datetime, timedelta

from platform_server.apps.collect.crud import (
    HistoryCursor,
    HistoryWindow,
    PointRef,
    build_aggregate_query,
    build_range_query,
)

SOURCE_ID = uuid.UUID("0192f0c0-0000-7000-8000-0000000000c1")
RANGE_START = datetime(2026, 8, 1, tzinfo=UTC)
RANGE_END = datetime(2026, 8, 2, tzinfo=UTC)


def build_window(*, row_limit: int = 100) -> HistoryWindow:
    """一个两点位的查询窗口。

    Args: row_limit。
    """
    return HistoryWindow(
        points=(
            PointRef(source_id=SOURCE_ID, point_code="outlet_temp"),
            PointRef(source_id=SOURCE_ID, point_code="inlet_temp"),
        ),
        range_start=RANGE_START,
        range_end=RANGE_END,
        row_limit=row_limit,
    )


def test_the_table_name_is_fully_qualified_to_the_collect_schema() -> None:
    sql, _ = build_range_query(build_window(), None)
    assert "collect.point_history" in sql


def test_point_codes_travel_as_bound_parameters() -> None:
    sql, params = build_range_query(build_window(), None)
    assert "outlet_temp" not in sql
    assert params["code_0"] == "outlet_temp"
    assert params["code_1"] == "inlet_temp"
    assert params["source_0"] == str(SOURCE_ID)


def test_the_range_is_bounded_on_both_sides() -> None:
    sql, params = build_range_query(build_window(), None)
    assert "ts >= :range_start" in sql
    assert "ts < :range_end" in sql
    assert params["range_start"] == RANGE_START
    assert params["range_end"] == RANGE_END


def test_the_range_binds_datetimes_not_their_text_form() -> None:
    _, params = build_range_query(build_window(), None)
    assert isinstance(params["range_start"], datetime)
    assert isinstance(params["range_end"], datetime)


def test_the_first_page_has_no_cursor_clause() -> None:
    sql, params = build_range_query(build_window(), None)
    assert "after_ts" not in sql
    assert "after_ts" not in params


def test_the_cursor_clause_orders_by_the_full_key() -> None:
    cursor = HistoryCursor(
        ts=RANGE_START, source_id=str(SOURCE_ID), point_code="outlet_temp"
    )
    sql, params = build_range_query(build_window(), cursor)
    assert "(ts, source_id, point_code)" in sql
    assert params["after_ts"] == RANGE_START
    assert params["after_source_id"] == str(SOURCE_ID)
    assert params["after_point_code"] == "outlet_temp"


def test_the_cursor_anchor_binds_a_datetime_not_its_text_form() -> None:
    cursor = HistoryCursor(
        ts=RANGE_START, source_id=str(SOURCE_ID), point_code="outlet_temp"
    )
    _, params = build_range_query(build_window(), cursor)
    assert isinstance(params["after_ts"], datetime)


def test_rows_come_back_in_a_deterministic_order() -> None:
    sql, _ = build_range_query(build_window(), None)
    assert "ORDER BY ts ASC, source_id ASC, point_code ASC" in sql


def test_the_row_limit_is_a_bound_parameter() -> None:
    sql, params = build_range_query(build_window(row_limit=7), None)
    assert "LIMIT :row_limit" in sql
    assert params["row_limit"] == 7


def test_the_bucket_carries_an_explicit_timezone() -> None:
    sql, params = build_aggregate_query(
        build_window(),
        aggregate_sql="avg(value_num)",
        interval=timedelta(minutes=15),
        timezone="Asia/Shanghai",
    )
    assert "timezone => :bucket_timezone" in sql
    assert params["bucket_timezone"] == "Asia/Shanghai"
    assert params["bucket_width"] == timedelta(minutes=15)


def test_the_bucket_width_binds_a_timedelta_not_its_text_form() -> None:
    _, params = build_aggregate_query(
        build_window(),
        aggregate_sql="avg(value_num)",
        interval=timedelta(minutes=15),
        timezone="UTC",
    )
    assert isinstance(params["bucket_width"], timedelta)


def test_the_aggregate_expression_reaches_the_select_list() -> None:
    sql, _ = build_aggregate_query(
        build_window(),
        aggregate_sql="max(value_num)",
        interval=timedelta(hours=1),
        timezone="UTC",
    )
    assert "max(value_num) AS bucket_value" in sql
    assert "count(value_num) AS sample_count" in sql


def test_buckets_are_grouped_per_point() -> None:
    sql, _ = build_aggregate_query(
        build_window(),
        aggregate_sql="avg(value_num)",
        interval=timedelta(days=1),
        timezone="UTC",
    )
    assert "GROUP BY source_id, point_code, bucket_start" in sql
    assert "ORDER BY bucket_start ASC, source_id ASC, point_code ASC" in sql
