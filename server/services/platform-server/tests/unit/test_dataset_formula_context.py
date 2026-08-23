"""历史行 → 预取值：窗口、跨行、整列、跨表四类取数的边界。

⚠ 全篇一条主线：**空与零永远分开**。`ALL_ZERO_OVER` 在空窗口上是空不是真，
`COUNT_ALL` 在「没取过数」时是空、在空表上才是 0
（docs/DATASET_DESIGN.md §5.5）。
"""

from datetime import UTC, datetime

import pytest

from platform_server.apps.dataset.formula import (
    EvalContext,
    ExternalsNotPrefetched,
    HistoryCache,
    RowSnapshot,
    WholeStats,
    build_externals,
    empty_cache,
    evaluate,
    parse_formula,
)

NOW = datetime(2026, 3, 31, 12, 0, tzinfo=UTC)


def row(hours_ago: float, **values: object) -> RowSnapshot:
    """造一条历史行。

    Args: hours_ago, values。
    """
    moment = datetime.fromtimestamp(NOW.timestamp() - hours_ago * 3600, tz=UTC)
    return RowSnapshot(ts=moment, values=dict(values))


def compute(source: str, cache: HistoryCache, **values: object) -> object:
    """用一份历史缓存算一条公式。

    Args: source, cache, values。
    """
    parsed = parse_formula(source)
    current = RowSnapshot(ts=NOW, values=dict(values))
    externals = build_externals(parsed.deps, cache, current)
    return evaluate(
        parsed, EvalContext(values=dict(values), externals=externals)
    )


def window_cache(*rows: RowSnapshot, literal: str = "1h") -> HistoryCache:
    """一份只装了某个窗口的缓存。

    Args: rows, literal。
    """
    return HistoryCache(tz=UTC, window_rows={literal: list(rows)})


def test_a_missing_prefetch_key_is_the_caller_s_fault_not_a_blank() -> None:
    # ⚠ 刻意不是 FormulaError：归成公式错误就把编程错误伪装成了数据问题
    parsed = parse_formula("PREV({a})")
    with pytest.raises(ExternalsNotPrefetched):
        evaluate(parsed, EvalContext(values={"a": 1}))


def test_a_prefetched_key_holding_none_is_a_legitimate_blank() -> None:
    cache = HistoryCache(tz=UTC)
    assert compute("PREV({a})", cache, a=1) is None


def test_prev_reads_the_row_before_this_one() -> None:
    cache = HistoryCache(
        tz=UTC, prev_rows=[row(1, 表读数=90), row(2, 表读数=80)]
    )
    assert compute("{表读数} - PREV({表读数})", cache, 表读数=100) == 10.0


def test_prev_counts_back_the_number_of_steps_it_is_given() -> None:
    cache = HistoryCache(tz=UTC, prev_rows=[row(1, a=9), row(2, a=8)])
    assert compute("PREV({a}, 2)", cache, a=1) == 8


def test_prev_is_blank_when_there_are_not_enough_earlier_rows() -> None:
    cache = HistoryCache(tz=UTC, prev_rows=[row(1, a=9)])
    assert compute("PREV({a}, 3)", cache, a=1) is None


def test_a_window_includes_the_current_row() -> None:
    cache = window_cache(row(0.5, a=1))
    assert compute("SUM_OVER({a}, '1h')", cache, a=10) == 11.0


def test_the_current_row_joins_a_window_only_when_it_holds_that_value() -> None:
    # ⚠ 正是这一点让 `SUM_OVER({自己}, '1y')` 不构成环
    cache = window_cache(row(0.5, 累计=1))
    assert compute("SUM_OVER({累计}, '1h')", cache) == 1.0


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("SUM_OVER({a}, '1h')", 6.0),
        ("AVG_OVER({a}, '1h')", 2.0),
        ("MIN_OVER({a}, '1h')", 1.0),
        ("MAX_OVER({a}, '1h')", 3.0),
        ("COUNT_OVER({a}, '1h')", 3.0),
        ("FIRST_OVER({a}, '1h')", 1),
        ("LAST_OVER({a}, '1h')", 3),
    ],
)
def test_the_window_family_aggregates_the_rows_in_the_window(
    source: str, expected: float
) -> None:
    cache = window_cache(row(0.9, a=1), row(0.5, a=2), row(0.1, a=3))
    assert compute(source, cache) == expected


def test_a_window_aggregate_skips_blanks_and_dirty_values() -> None:
    # 一个窗口横跨很多行，一格脏数据不该毙掉整条公式
    cache = window_cache(row(0.9, a=1), row(0.5, a="停机"), row(0.1, a=None))
    assert compute("SUM_OVER({a}, '1h')", cache) == 1.0
    assert compute("COUNT_OVER({a}, '1h')", cache) == 2.0


def test_an_empty_window_is_blank_for_every_aggregate_but_the_count() -> None:
    cache = window_cache()
    assert compute("SUM_OVER({a}, '1h')", cache) is None
    assert compute("AVG_OVER({a}, '1h')", cache) is None
    assert compute("MIN_OVER({a}, '1h')", cache) is None
    assert compute("MAX_OVER({a}, '1h')", cache) is None
    assert compute("FIRST_OVER({a}, '1h')", cache) is None
    assert compute("LAST_OVER({a}, '1h')", cache) is None
    # 数得清就是 0
    assert compute("COUNT_OVER({a}, '1h')", cache) == 0.0


def test_all_zero_over_has_three_outcomes() -> None:
    zeros = window_cache(row(0.9, a=0), row(0.5, a=0))
    mixed = window_cache(row(0.9, a=0), row(0.5, a=1))
    assert compute("ALL_ZERO_OVER({a}, '1h')", zeros) is True
    assert compute("ALL_ZERO_OVER({a}, '1h')", mixed) is False
    # ⚠ 空窗口是**空**不是真：混成一档会把一张刚建好的空表送进归零那一支
    assert compute("ALL_ZERO_OVER({a}, '1h')", window_cache()) is None


def test_rows_outside_the_window_do_not_count() -> None:
    cache = window_cache(row(0.5, a=1), row(5, a=100))
    assert compute("SUM_OVER({a}, '1h')", cache) == 1.0


def test_the_whole_column_family_derives_from_one_set_of_statistics() -> None:
    stats = WholeStats(minimum=1.0, maximum=9.0, total=15.0, count=3)
    cache = HistoryCache(tz=UTC, whole_stats={"a": stats})
    assert compute("MIN_ALL({a})", cache) == 1.0
    assert compute("MAX_ALL({a})", cache) == 9.0
    assert compute("SUM_ALL({a})", cache) == 15.0
    assert compute("AVG_ALL({a})", cache) == 5.0
    assert compute("COUNT_ALL({a})", cache) == 3.0


def test_an_empty_table_counts_zero_but_aggregates_to_blank() -> None:
    cache = HistoryCache(tz=UTC, whole_stats={"a": WholeStats()})
    assert compute("COUNT_ALL({a})", cache) == 0.0
    assert compute("MIN_ALL({a})", cache) is None
    assert compute("AVG_ALL({a})", cache) is None


def test_a_column_that_was_never_fetched_counts_blank_not_zero() -> None:
    # ⚠ 「不知道」与「没有」不是一回事
    assert compute("COUNT_ALL({a})", HistoryCache(tz=UTC)) is None


def test_folding_a_not_yet_persisted_value_into_the_statistics() -> None:
    # 新建那一行还不在库里；不并进来的话，它正好是新极值时归一化会越界
    stats = WholeStats(minimum=1.0, maximum=2.0, total=3.0, count=2)
    folded = stats.fold(9)
    assert (folded.minimum, folded.maximum, folded.total, folded.count) == (
        1.0,
        9.0,
        12.0,
        3,
    )


def test_folding_starts_the_statistics_when_there_is_nothing_yet() -> None:
    folded = WholeStats().fold(4)
    assert (folded.minimum, folded.maximum, folded.total, folded.count) == (
        4.0,
        4.0,
        4.0,
        1,
    )


@pytest.mark.parametrize("value", [None, "  ", "停机"])
def test_folding_skips_what_it_cannot_read_as_a_number(value: object) -> None:
    assert WholeStats(count=1).fold(value).count == 1


def test_a_cross_table_reference_reads_the_other_table_as_of_this_row() -> None:
    cache = HistoryCache(
        tz=UTC,
        external_rows={
            "src": [row(48, 基准=1), row(5, 基准=2), row(-5, 基准=99)]
        },
    )
    assert compute("{src.基准} * 10", cache) == 20.0


def test_a_cross_table_reference_is_blank_before_the_other_table_starts() -> (
    None
):
    cache = HistoryCache(tz=UTC, external_rows={"src": [row(-5, 基准=1)]})
    assert compute("{src.基准} * 10", cache) is None


def test_a_cross_table_reference_is_blank_when_nothing_was_fetched() -> None:
    assert compute("{src.基准} * 10", HistoryCache(tz=UTC)) is None


def test_the_current_row_never_joins_the_other_table_s_window() -> None:
    # ⚠ 与本表窗口相反：当前行属于本表，并进去是凭空多一个值——两张表有同名列
    # 时尤其难发现
    cache = HistoryCache(tz=UTC, external_rows={"src": [row(0.5, a=1)]})
    assert compute("SUM_OVER({src.a}, '1h')", cache, a=1000) == 1.0


def test_a_cross_table_whole_column_aggregate_reads_its_own_statistics() -> (
    None
):
    cache = HistoryCache(
        tz=UTC, whole_stats={"src.a": WholeStats(total=7.0, count=1)}
    )
    assert compute("SUM_ALL({src.a})", cache) == 7.0


def test_a_trial_run_reads_every_history_reference_as_unknown() -> None:
    # ⚠ 包括 COUNT_OVER：给 0 等于断言「这一段一条记录都没有」，而事实是压根
    # 没去查（docs/DATASET_DESIGN.md §7.13 宁可说不知道）
    parsed = parse_formula(
        "COUNT_OVER({a}, '1h') + SUM_ALL({a}) + PREV({a}) + {src.b}"
    )
    externals = build_externals(parsed.deps, empty_cache(), None)
    assert set(externals.values()) == {None}
    assert len(externals) == 4
