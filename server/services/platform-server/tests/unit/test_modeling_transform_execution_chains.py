"""真实转换链的可核对终值、时刻、拟合隔离与物理单位。"""

from dataclasses import replace

import pytest

from platform_server.apps.modeling.operators import Frame, registry
from unit.transform_execution_fakes import HOUR, MINUTE, matrix, numbers


def step(
    code: str,
    source: Frame,
    config: dict[str, object],
    *,
    plan: dict[str, object] | None = None,
) -> Frame:
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=plan)
    output = operator.run({"frame": source})["frame"]
    assert isinstance(output, Frame)
    return output


def test_cleaning_chain_preserves_selected_values_and_original_timestamps() -> (
    None
):
    raw = matrix(
        ("value", "other"),
        (("1", "10"), ("bad", "20"), ("3", None), ("9", "40")),
    )
    cast = step(
        "cast_type", raw, {"columns": ["value", "other"], "to": "number"}
    )
    filled = step(
        "fill_missing",
        cast,
        {"columns": ["value"], "strategy": "constant", "value": 2.0},
    )
    filtered = step(
        "filter_rows", filled, {"column": "value", "op": "gte", "value": 2.0}
    )
    complete = step("drop_missing", filtered, {"subset": ["other"]})
    result = step("select_columns", complete, {"columns": ["other", "value"]})
    assert result.keys == ("other", "value")
    assert result.rows == ((20.0, 2.0), (40.0, 9.0))
    assert result.index == (MINUTE, 3 * MINUTE)
    assert result.column_of("value").unit == "kWh"
    assert result.provenance == raw.provenance
    assert raw.rows[1] == ("bad", "20")


def test_temporal_chain_preserves_lag_and_rolling_measurement_units() -> None:
    raw = replace(
        numbers([1.0, 2.0, 3.0, 4.0]), index=(0, MINUTE, 5 * MINUTE, 6 * MINUTE)
    )
    folded = step("resample", raw, {"bucket": "5m", "agg": "sum"})
    shifted = step("time_shift", folded, {"offset_minutes": 60})
    clock = step("time_feature", shifted, {"parts": ["hour"]})
    lagged = step("lag_feature", clock, {"columns": ["value"], "lags": [1]})
    rolled = step(
        "rolling_feature",
        lagged,
        {"columns": ["value"], "window": 2, "stats": ["mean", "sum"]},
    )
    difference = step(
        "difference", rolled, {"columns": ["value"], "method": "pct_change"}
    )
    result = step("cumulative_stats", difference, {"columns": ["value"]})
    assert result.values_of("value") == [3.0, 7.0]
    assert result.values_of("ts_hour") == [1.0, 1.0]
    assert result.values_of("value@lag1") == [None, 3.0]
    assert result.values_of("value@mean2") == [None, 5.0]
    assert result.values_of("value@sum2") == [None, 10.0]
    assert result.values_of("value_change")[1] == pytest.approx(400 / 3)
    assert result.values_of("value_cumulative") == [3.0, 10.0]
    assert result.index == (HOUR, HOUR + 5 * MINUTE)
    assert result.column_of("value@lag1").unit == "kWh"
    assert result.column_of("value@mean2").unit == "kWh"
    assert result.column_of("value@sum2").unit == "kWh"
    assert result.column_of("value_change").unit == ""


def test_group_join_and_concat_chain_keeps_business_keys_and_totals() -> None:
    raw = matrix(
        ("category", "value"),
        ((" A ", 1.0), (" A ", 3.0), ("B", 2.0), ("B", 4.0)),
    )
    cleaned = step(
        "text_transform", raw, {"columns": ["category"], "method": "strip"}
    )
    grouped = step(
        "group_aggregate",
        cleaned,
        {"group_columns": ["category"], "columns": ["value"], "agg": "sum"},
    )
    right = matrix(
        ("category", "factor"), (("A", 2.0), ("B", 3.0)), should_index=False
    )
    joiner, _ = registry.build(
        "key_join", {"left_key": "category", "right_key": "category"}
    )
    joined = joiner.run({"left": grouped, "right": right})["frame"]
    assert isinstance(joined, Frame)
    multiplied = step(
        "column_math",
        joined,
        {
            "left_column": "value_sum",
            "right_mode": "column",
            "right_column": "right_factor",
            "method": "multiply",
        },
    )
    extra = replace(multiplied, rows=multiplied.rows[:1])
    merger, _ = registry.build("concat_rows", {})
    merged = merger.run({"left": multiplied, "right": extra})["frame"]
    assert isinstance(merged, Frame)
    assert merged.values_of("calculated") == [8.0, 18.0, 8.0]
    result = step(
        "deduplicate", merged, {"columns": ["category"], "keep": "first"}
    )
    assert result.values_of("calculated") == [8.0, 18.0]
    assert result.values_of("value_sum") == [4.0, 6.0]
    assert result.column_of("value_sum").unit == "kWh"
    assert result.provenance == raw.provenance


def test_fitted_feature_chain_uses_training_prefix_and_preserves_target() -> (
    None
):
    raw = matrix(
        ("value", "other", "target"),
        (
            (1.0, 8.0, 11.0),
            (None, 8.0, 12.0),
            (3.0, 8.0, 13.0),
            (1000.0, 8.0, 14.0),
        ),
    )
    plan: dict[str, object] = {
        "method": "time_order",
        "test_ratio": 0.25,
        "random_state": 42,
        "target_column": "target",
    }
    filled = step(
        "fill_missing",
        raw,
        {"columns": ["value"], "strategy": "mean"},
        plan=plan,
    )
    assert filled.values_of("value") == [1.0, 2.0, 3.0, 1000.0]
    clipped = step(
        "clip_outlier",
        filled,
        {"columns": ["value"], "threshold": 1.0},
        plan=plan,
    )
    scaled = step(
        "standardize",
        clipped,
        {"columns": ["value"], "method": "minmax"},
        plan=plan,
    )
    selected = step(
        "select_feature",
        scaled,
        {"columns": ["value", "other"], "top_k": 1},
        plan=plan,
    )
    result = step(
        "pca", selected, {"columns": ["value"], "n_components": 1}, plan=plan
    )
    assert result.values_of("pc1") == pytest.approx([-0.5, 0.0, 0.5, 0.5])
    assert result.values_of("target") == [11.0, 12.0, 13.0, 14.0]
    assert result.column_of("target").role == "target"
    assert result.index == raw.index


@pytest.mark.parametrize(
    ("is_ascending", "expected"),
    [(True, [1.5, 3.0, 1.5, None]), (False, [2.5, 1.0, 2.5, None])],
)
def test_rank_direction_and_ties_are_visible_in_actual_values(
    is_ascending: bool, expected: list[float | None]
) -> None:
    result = step(
        "rank_rows",
        numbers([1.0, 3.0, 1.0, None]),
        {"column": "value", "is_ascending": is_ascending, "method": "average"},
    )
    assert result.values_of("rank") == expected


@pytest.mark.parametrize(
    ("columns", "indices"),
    [
        (["category", "value"], [2, 0, 1, 3]),
        (["value", "category"], [2, 1, 0, 3]),
    ],
)
def test_sorting_changes_with_explicit_column_priority(
    columns: list[str], indices: list[int]
) -> None:
    source = matrix(
        ("value", "category"), ((2.0, "A"), (1.0, "B"), (1.0, "A"), (2.0, "B"))
    )
    result = step("sort_rows", source, {"columns": columns})
    assert result.rows == tuple(source.rows[seat] for seat in indices)
    assert result.index == tuple(seat * MINUTE for seat in indices)


@pytest.mark.parametrize(("agg", "expected"), [("first", 1.0), ("last", 3.0)])
def test_grouped_first_and_last_use_distinct_nonmissing_observations(
    agg: str, expected: float
) -> None:
    source = matrix(
        ("category", "value"), (("A", 1.0), ("A", None), ("A", 3.0))
    )
    result = step(
        "group_aggregate",
        source,
        {"group_columns": ["category"], "columns": ["value"], "agg": agg},
    )
    assert result.rows == (("A", expected),)
