"""归档宽表查询的 SQL 契约。

守的是三条：跨 schema 只读且表名完全限定、值一律绑定参数、
`time_bucket` 必须带 `timezone =>`（不带就按 UNIX 纪元对齐，日桶会偏 8 小时）。
"""

import uuid

from platform_server.apps.collect.crud import (
    HistoryCursor,
    HistoryWindow,
    PointRef,
    build_aggregate_query,
    build_range_query,
)

SOURCE_ID = uuid.UUID("0192f0c0-0000-7000-8000-0000000000c1")
RANGE_START = "2026-08-01T00:00:00.000Z"
RANGE_END = "2026-08-02T00:00:00.000Z"


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
        interval="15 minutes",
        timezone="Asia/Shanghai",
    )
    assert "timezone => :bucket_timezone" in sql
    assert params["bucket_timezone"] == "Asia/Shanghai"
    assert params["bucket_width"] == "15 minutes"


def test_the_aggregate_expression_reaches_the_select_list() -> None:
    sql, _ = build_aggregate_query(
        build_window(),
        aggregate_sql="max(value_num)",
        interval="1 hours",
        timezone="UTC",
    )
    assert "max(value_num) AS bucket_value" in sql
    assert "count(value_num) AS sample_count" in sql


def test_buckets_are_grouped_per_point() -> None:
    sql, _ = build_aggregate_query(
        build_window(),
        aggregate_sql="avg(value_num)",
        interval="1 days",
        timezone="UTC",
    )
    assert "GROUP BY source_id, point_code, bucket_start" in sql
    assert "ORDER BY bucket_start ASC, source_id ASC, point_code ASC" in sql
