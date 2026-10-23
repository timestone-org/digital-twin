"""台账自然日窗口与完整采样合计的公开求值口径。"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from platform_server.apps.dataset.formula import (
    EvalContext,
    FormulaError,
    HistoryCache,
    RowSnapshot,
    build_externals,
    evaluate,
    parse_formula,
    parse_window,
    to_notation,
    window_lower_bound,
)

SHANGHAI = ZoneInfo("Asia/Shanghai")
MIDNIGHT = datetime(2026, 10, 22, 16, 0, tzinfo=UTC)


def calculate(
    formula: str, current: RowSnapshot, history: list[RowSnapshot]
) -> object:
    """从公开公式入口计算窗口。Args: formula, current, history。"""
    parsed = parse_formula(formula)
    cache = HistoryCache(
        tz=SHANGHAI,
        window_rows={ref.spec.literal: history for ref in parsed.deps.window},
    )
    return evaluate(
        parsed,
        EvalContext(
            values=current.values,
            externals=build_externals(parsed.deps, cache, current),
        ),
    )


def test_today_includes_the_local_midnight_bucket_and_excludes_yesterday() -> (
    None
):
    history = [
        RowSnapshot(datetime(2026, 10, 22, 15, 55, tzinfo=UTC), {"电量": 90}),
        RowSnapshot(MIDNIGHT, {"电量": 2}),
    ]
    current = RowSnapshot(
        datetime(2026, 10, 22, 16, 5, tzinfo=UTC), {"电量": 3}
    )

    assert calculate("SUM_OVER({电量}, 'today')", current, history) == 5.0


def test_a_complete_day_sum_requires_every_bucket_from_midnight() -> None:
    history = [RowSnapshot(MIDNIGHT, {"电量": 2})]
    current = RowSnapshot(
        datetime(2026, 10, 22, 16, 5, tzinfo=UTC), {"电量": 3}
    )

    assert (
        calculate("SUM_COMPLETE_OVER({电量}, 'today', 300)", current, history)
        == 5.0
    )


@pytest.mark.parametrize(
    ("function", "expected"),
    [
        ("AVG", 2.5),
        ("MIN", 2.0),
        ("MAX", 3.0),
        ("COUNT", 2.0),
        ("FIRST", 2.0),
        ("LAST", 3.0),
    ],
)
def test_the_existing_window_family_accepts_today(
    function: str, expected: float
) -> None:
    history = [RowSnapshot(MIDNIGHT, {"电量": 2})]
    current = RowSnapshot(MIDNIGHT + timedelta(minutes=5), {"电量": 3})

    assert (
        calculate(f"{function}_OVER({{电量}}, 'today')", current, history)
        == expected
    )


def test_one_day_keeps_its_rolling_twenty_four_hour_meaning() -> None:
    history = [
        RowSnapshot(MIDNIGHT - timedelta(minutes=5), {"电量": 90}),
        RowSnapshot(MIDNIGHT, {"电量": 2}),
    ]
    current = RowSnapshot(MIDNIGHT + timedelta(minutes=5), {"电量": 3})

    assert calculate("SUM_OVER({电量}, '1d')", current, history) == 95.0


@pytest.mark.parametrize(
    "values",
    [
        [(0, 2), (10, 4)],
        [(5, 3), (10, 4)],
        [(0, None), (5, 3), (10, 4)],
        [(0, 2), (5, "故障"), (10, 4)],
        [(0, 2), (5, float("nan")), (10, 4)],
        [(0, 2), (5, 3), (10, None)],
        [(0, 2), (0, 9), (5, 3), (10, 4)],
        [(0, 2), (6, 3), (10, 4)],
    ],
    ids=[
        "missing-middle",
        "missing-midnight",
        "blank-first",
        "dirty",
        "nonfinite",
        "blank-current",
        "duplicate",
        "off-grid",
    ],
)
def test_a_day_sum_is_blank_when_any_bucket_is_missing_or_invalid(
    values: list[tuple[int, object]],
) -> None:
    rows = [
        RowSnapshot(MIDNIGHT + timedelta(minutes=minute), {"电量": value})
        for minute, value in values
    ]

    assert (
        calculate(
            "SUM_COMPLETE_OVER({电量}, 'today', 300)", rows[-1], rows[:-1]
        )
        is None
    )


def test_a_complete_midnight_bucket_can_be_a_real_zero() -> None:
    assert (
        calculate(
            "SUM_COMPLETE_OVER({电量}, 'today', 300)",
            RowSnapshot(MIDNIGHT, {"电量": 0}),
            [],
        )
        == 0.0
    )


def test_a_null_current_row_cannot_be_hidden_by_a_duplicate_timestamp() -> None:
    history = [
        RowSnapshot(MIDNIGHT, {"电量": 2}),
        RowSnapshot(MIDNIGHT + timedelta(minutes=5), {"电量": 3}),
    ]
    current = RowSnapshot(MIDNIGHT + timedelta(minutes=5), {"电量": None})

    assert (
        calculate("SUM_COMPLETE_OVER({电量}, 'today', 300)", current, history)
        is None
    )


def test_a_day_sum_restarts_at_the_next_local_midnight() -> None:
    history = [RowSnapshot(MIDNIGHT, {"电量": 99})]
    current = RowSnapshot(MIDNIGHT + timedelta(days=1), {"电量": 4})

    assert (
        calculate("SUM_COMPLETE_OVER({电量}, 'today', 300)", current, history)
        == 4.0
    )


def test_a_day_sum_requires_an_aligned_current_bucket() -> None:
    current = RowSnapshot(MIDNIGHT + timedelta(seconds=301), {"电量": 4})

    assert (
        calculate(
            "SUM_COMPLETE_OVER({电量}, 'today', 300)",
            current,
            [RowSnapshot(MIDNIGHT, {"电量": 2})],
        )
        is None
    )


@pytest.mark.parametrize(
    "formula",
    [
        "SUM_COMPLETE_OVER({电量}, '1d', 300)",
        "SUM_COMPLETE_OVER({电量}, 'today')",
        "SUM_COMPLETE_OVER({电量}, 'today', 0)",
        "SUM_COMPLETE_OVER({电量}, 'today', -1)",
        "SUM_COMPLETE_OVER({电量}, 'today', 86401)",
        "SUM_COMPLETE_OVER({电量}, 'today', True)",
        "SUM_COMPLETE_OVER({电量}, 'today', 300.0)",
        "SUM_COMPLETE_OVER({电量}, 'today', 5 * 60)",
        "SUM_OVER({电量}, 'today', 300)",
    ],
)
def test_complete_window_arguments_are_checked_at_parse_time(
    formula: str,
) -> None:
    with pytest.raises(FormulaError):
        parse_formula(formula)


def test_step_size_is_part_of_the_existing_dependency_window_string() -> None:
    deps = parse_formula("SUM_COMPLETE_OVER({电量}, 'today', 300)").deps

    assert deps.to_json()["window"] == [
        {"func": "SUM_COMPLETE_OVER", "key": "电量", "window": "today@300s"}
    ]


def test_today_and_rolling_windows_keep_independent_prefetch_keys() -> None:
    history = [RowSnapshot(MIDNIGHT, {"电量": 2})]
    current = RowSnapshot(MIDNIGHT + timedelta(minutes=5), {"电量": 3})

    assert (
        calculate(
            "SUM_OVER({电量}, 'today') + "
            "SUM_COMPLETE_OVER({电量}, 'today', 300)",
            current,
            history,
        )
        == 10.0
    )


def test_the_complete_window_notation_preserves_all_three_arguments() -> None:
    tree = to_notation(
        parse_formula("SUM_COMPLETE_OVER({电量}, 'today', 300)"), {}
    )

    assert tree["t"] == "fn"
    assert tree["name"] == "SUM_COMPLETE_OVER"
    assert len(tree["args"]) == 3


def test_today_is_resolved_in_the_business_timezone() -> None:
    anchor = datetime(2026, 10, 22, 18, 0, tzinfo=UTC)

    assert (
        window_lower_bound(anchor, parse_window("today"), SHANGHAI) == MIDNIGHT
    )


def test_a_repeated_local_midnight_uses_the_first_occurrence() -> None:
    anchor = datetime(2026, 11, 1, 5, 30, tzinfo=UTC)

    assert window_lower_bound(
        anchor, parse_window("today"), ZoneInfo("America/Havana")
    ) == datetime(2026, 11, 1, 4, 0, tzinfo=UTC)
