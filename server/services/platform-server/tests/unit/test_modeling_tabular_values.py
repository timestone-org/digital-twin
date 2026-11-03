"""数值、文本、顺序统计与分箱的真实计算和缺失语义。"""

import math
from dataclasses import replace

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)
from unit.tabular_fakes import run, table


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("strip", "A"),
        ("lower", " a "),
        ("upper", " A "),
        ("replace", " X "),
        ("prefix", "X A "),
        ("suffix", " A X"),
        ("length", 3.0),
    ],
)
def test_text_operations_are_literal_and_keep_missing(
    method: str, expected: str | float
) -> None:
    result = run(
        "text_transform",
        {
            "columns": ["label"],
            "method": method,
            "find": "A",
            "replacement": "X",
        },
    )
    assert result.rows[0][3] == expected
    assert result.rows[-1][3] is None
    assert result.index == table().index
    assert result.provenance == table().provenance
    assert result.column_of("label").dtype == (
        "number" if method == "length" else "string"
    )


def test_text_rejects_invalid_columns_empty_needle_and_excessive_result() -> (
    None
):
    with pytest.raises(OperatorError, match="不是文本"):
        run("text_transform", {"columns": ["x"]})
    with pytest.raises(ValidationError, match="查找文本"):
        registry.build("text_transform", {"method": "replace"})
    source = replace(
        table(), rows=(("a", 1.0, 2.0, "a" * 4096),), index=(1000,)
    )
    with pytest.raises(OperatorError, match="4096"):
        run(
            "text_transform",
            {"columns": ["label"], "method": "suffix", "replacement": "b"},
            source,
        )


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("abs", 4.0),
        ("log", math.log(4)),
        ("log1p", math.log(5)),
        ("sqrt", 2.0),
        ("square", 16.0),
        ("exp", math.exp(4)),
        ("round", 4.0),
        ("affine", 11.0),
    ],
)
def test_numeric_transform_has_real_math_and_preserves_missing(
    method: str, expected: float
) -> None:
    source = replace(table(), rows=(("a", 4.0, None, None),), index=(1000,))
    result = run(
        "numeric_transform",
        {"method": method, "factor": 2.0, "offset": 3.0},
        source,
    )
    assert result.rows[0][1] == pytest.approx(expected)
    assert result.rows[0][2] is None
    assert result.keys == source.keys
    assert result.index == source.index
    assert result.column_of("x").unit == (
        "kWh" if method in {"abs", "round", "affine"} else ""
    )


@pytest.mark.parametrize(
    ("method", "value"),
    [
        ("log", -1.0),
        ("log1p", -2.0),
        ("sqrt", -1.0),
        ("exp", 1000.0),
        ("square", 1e308),
    ],
)
def test_numeric_domain_and_overflow_follow_explicit_strategy(
    method: str, value: float
) -> None:
    source = replace(table(), rows=(("a", value, 1.0, None),), index=(1000,))
    with pytest.raises(OperatorError):
        run("numeric_transform", {"columns": ["x"], "method": method}, source)
    result = run(
        "numeric_transform",
        {"columns": ["x"], "method": method, "on_invalid": "null"},
        source,
    )
    assert result.rows[0][1] is None


def test_replace_is_exact_and_missing_is_only_filled_when_enabled() -> None:
    result = run(
        "replace_values", {"columns": ["x"], "match": 1.0, "replacement": 0.0}
    )
    assert result.values_of("x") == [0.0, 0.0, None, 3.0]
    filled = run(
        "replace_values",
        {
            "columns": ["x"],
            "match": 1.0,
            "replacement": 0.0,
            "should_include_missing": True,
        },
    )
    assert filled.values_of("x") == [0.0, 0.0, 0.0, 3.0]
    assert filled.columns == table().columns


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("add", 3.0),
        ("subtract", -1.0),
        ("multiply", 2.0),
        ("divide", 0.5),
        ("min", 1.0),
        ("max", 2.0),
    ],
)
def test_column_math_creates_a_feature_and_never_overwrites(
    method: str, expected: float
) -> None:
    result = run(
        "column_math",
        {
            "left_column": "x",
            "right_mode": "column",
            "right_column": "y",
            "method": method,
        },
    )
    assert result.values_of("calculated") == [
        expected,
        None,
        None,
        {
            "add": 7.0,
            "subtract": -1.0,
            "multiply": 12.0,
            "divide": 0.75,
            "min": 3.0,
            "max": 4.0,
        }[method],
    ]
    assert result.columns[-1].role == "feature"
    assert result.columns[:4] == table().columns
    with pytest.raises(OperatorError, match="重复"):
        run("column_math", {"left_column": "x", "output_column": "x"})


def test_column_math_requires_right_column_and_handles_zero_and_overflow() -> (
    None
):
    with pytest.raises(ValidationError, match="右侧"):
        registry.build(
            "column_math", {"left_column": "x", "right_mode": "column"}
        )
    with pytest.raises(OperatorError, match="除零"):
        run(
            "column_math",
            {"left_column": "x", "constant": 0.0, "method": "divide"},
        )
    result = run(
        "column_math",
        {
            "left_column": "x",
            "constant": 0.0,
            "method": "divide",
            "on_invalid": "null",
        },
    )
    assert result.values_of("calculated") == [None] * 4
    huge = replace(table(), rows=(("a", 1e308, 1.0, None),), index=(1000,))
    with pytest.raises(OperatorError, match="非有限"):
        run(
            "column_math",
            {"left_column": "x", "constant": 1e308, "method": "multiply"},
            huge,
        )


def ordered_values() -> Frame:
    return Frame(
        columns=(
            FrameColumn(key="x", name="用量", dtype="number", unit="kWh"),
        ),
        rows=((2.0,), (4.0,), (None,), (0.0,), (6.0,)),
        index=(1000, 2000, 3000, 4000, 5000),
    )


@pytest.mark.parametrize(
    ("method", "values"),
    [
        ("difference", [None, 2.0, None, None, 6.0]),
        ("pct_change", [None, 100.0, None, None, None]),
        ("ratio", [None, 2.0, None, None, None]),
    ],
)
def test_difference_respects_gaps_previous_zero_and_index(
    method: str, values: list[float | None]
) -> None:
    source = ordered_values()
    result = run("difference", {"columns": ["x"], "method": method}, source)
    assert result.values_of("x_change") == values
    assert result.index == source.index
    assert result.column_of("x_change").unit == (
        "kWh" if method == "difference" else ""
    )
    assert run(
        "difference", {"columns": ["x"], "periods": 2}, source
    ).values_of("x_change") == [None, None, None, -4.0, None]


def test_difference_rejects_zero_when_requested_and_unordered_time() -> None:
    with pytest.raises(OperatorError, match="前值为零"):
        run(
            "difference",
            {"columns": ["x"], "method": "ratio", "on_zero": "error"},
            ordered_values(),
        )
    with pytest.raises(OperatorError, match="严格递增"):
        run("difference", {}, replace(ordered_values(), index=(1, 2, 2, 4, 5)))
    assert (
        run(
            "difference",
            {"columns": ["x"]},
            replace(ordered_values(), index=None),
        ).index
        is None
    )


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("sum", [2.0, 6.0, None, 6.0, 12.0]),
        ("mean", [2.0, 3.0, None, 2.0, 3.0]),
        ("min", [2.0, 2.0, None, 0.0, 0.0]),
        ("max", [2.0, 4.0, None, 4.0, 6.0]),
    ],
)
def test_cumulative_never_uses_future_values_and_skips_missing(
    method: str, expected: list[float | None]
) -> None:
    result = run(
        "cumulative_stats",
        {"columns": ["x"], "method": method},
        ordered_values(),
    )
    assert result.values_of("x_cumulative") == expected
    assert result.column_of("x_cumulative").unit == "kWh"
    prefix = replace(
        ordered_values(), rows=ordered_values().rows[:2], index=(1000, 2000)
    )
    assert (
        run(
            "cumulative_stats", {"columns": ["x"], "method": method}, prefix
        ).values_of("x_cumulative")
        == expected[:2]
    )


def test_cumulative_propagates_missing_and_rejects_nonchronological_input() -> (
    None
):
    assert run(
        "cumulative_stats",
        {"columns": ["x"], "missing_policy": "propagate"},
        ordered_values(),
    ).values_of("x_cumulative") == [2.0, 6.0, None, None, None]
    with pytest.raises(OperatorError, match="严格递增"):
        run(
            "cumulative_stats",
            {},
            replace(ordered_values(), index=(5, 4, 3, 2, 1)),
        )


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("average", [2.5, 2.5, None, 1.0]),
        ("min", [2.0, 2.0, None, 1.0]),
        ("dense", [2.0, 2.0, None, 1.0]),
        ("ordinal", [2.0, 3.0, None, 1.0]),
    ],
)
def test_rank_ties_are_explicit_and_keep_row_order(
    method: str, expected: list[float | None]
) -> None:
    result = run("rank_rows", {"column": "x", "method": method})
    assert result.values_of("rank") == expected
    assert result.index == table().index
    assert run(
        "rank_rows", {"column": "x", "group_columns": ["id"], "method": "dense"}
    ).values_of("rank") == [1.0, 1.0, None, 1.0]


def test_describe_has_real_count_quartiles_and_sample_deviation() -> None:
    result = run("describe_stats", {"columns": ["x"]})
    assert result.rows[0][:3] == ("x", 3.0, 1.0)
    assert result.rows[0][3] == pytest.approx(5 / 3)
    assert result.rows[0][4] == pytest.approx(math.sqrt(4 / 3))
    assert result.rows[0][5:] == (1.0, 1.0, 1.0, 2.0, 3.0)
    assert result.index is None
    assert result.provenance == table().provenance


def test_describe_empty_singleton_and_extreme_values_stay_finite() -> None:
    empty = replace(ordered_values(), rows=(), index=())
    assert run("describe_stats", {}, empty).rows == (
        ("x", 0.0, 0.0, None, None, None, None, None, None, None),
    )
    one = replace(empty, rows=((3.0,),), index=(1,))
    assert run("describe_stats", {}, one).rows[0][4] is None
    assert run("describe_stats", {"ddof": "population"}, one).rows[0][4] == 0.0
    large = replace(empty, rows=((1e308,), (1e308,)), index=(1, 2))
    assert run("describe_stats", {}, large).rows[0][3:5] == (1e308, 0.0)


@pytest.mark.parametrize("method", ["pearson", "spearman"])
def test_correlation_reports_pairwise_counts_and_constant_unknown(
    method: str,
) -> None:
    source = Frame(
        columns=(
            FrameColumn(key="x", name="x", dtype="number"),
            FrameColumn(key="y", name="y", dtype="number"),
            FrameColumn(key="z", name="z", dtype="number"),
        ),
        rows=(
            (1.0, 2.0, 1.0),
            (2.0, 4.0, 1.0),
            (3.0, None, 1.0),
            (4.0, 8.0, 1.0),
        ),
    )
    result = run("correlation", {"method": method}, source)
    by_pair = {(row[0], row[1]): row[2:] for row in result.rows}
    assert by_pair[("x", "y")][0] == pytest.approx(1.0)
    assert by_pair[("x", "y")][1] == 3.0
    assert by_pair[("x", "z")] == (None, 4.0)
    assert by_pair[("z", "z")] == (None, 4.0)
    assert result.index is None


def test_correlation_missing_pairs_limits_and_large_values() -> None:
    assert run("correlation", {"columns": ["x", "y"]}).rows[1] == (
        "x",
        "y",
        None,
        2.0,
    )
    source = Frame(
        columns=tuple(
            FrameColumn(key=f"c{seat}", name=f"c{seat}", dtype="number")
            for seat in range(33)
        ),
        rows=(),
    )
    with pytest.raises(OperatorError, match="32"):
        run("correlation", {}, source)
    large = Frame(
        columns=(FrameColumn(key="x", name="x", dtype="number"),),
        rows=((1e308,), (-1e308,), (0.0,)),
    )
    assert run("correlation", {}, large).rows == (("x", "x", 1.0, 3.0),)


@pytest.mark.parametrize(
    ("is_right_closed", "expected"),
    [(True, [0.0, 0.0, 1.0, 2.0, None]), (False, [0.0, 1.0, 2.0, 2.0, None])],
)
def test_bins_include_extremes_and_explicit_boundary_side(
    is_right_closed: bool, expected: list[float | None]
) -> None:
    source = replace(
        ordered_values(), rows=((-1.0,), (0.0,), (10.0,), (100.0,), (None,))
    )
    result = run(
        "binning",
        {
            "columns": ["x"],
            "boundaries": [0.0, 10.0],
            "is_right_closed": is_right_closed,
        },
        source,
    )
    assert result.values_of("x_bin") == expected
    assert result.index == source.index
    assert result.column_of("x_bin").unit == ""


@pytest.mark.parametrize(
    "boundaries", [[], [1.0, 1.0], [2.0, 1.0], [math.inf], [math.nan]]
)
def test_binning_rejects_nonfinite_duplicate_and_unsorted_boundaries(
    boundaries: list[float],
) -> None:
    with pytest.raises(ValidationError):
        registry.build("binning", {"boundaries": boundaries})


@pytest.mark.parametrize(
    "code",
    [
        "numeric_transform",
        "replace_values",
        "difference",
        "cumulative_stats",
        "binning",
        "describe_stats",
        "correlation",
    ],
)
def test_automatic_numeric_selection_excludes_target(code: str) -> None:
    source = replace(
        table(),
        columns=tuple(
            replace(column, role="target") if column.key == "x" else column
            for column in table().columns
        ),
    )
    result = run(code, {}, source)
    if code in {"describe_stats", "correlation"}:
        assert all("x" not in row[:2] for row in result.rows)
    else:
        assert result.values_of("x") == source.values_of("x")
        assert not any(key.startswith("x_") for key in result.keys)


def test_derived_names_are_bounded_and_do_not_overwrite() -> None:
    source = Frame(
        columns=(FrameColumn(key="x" * 256, name="long", dtype="number"),),
        rows=((1.0,),),
    )
    with pytest.raises(OperatorError, match="256 字符"):
        run("difference", {}, source)
    with pytest.raises(OperatorError, match="重复"):
        run("rank_rows", {"column": "x", "output_column": "label"})


def test_text_and_numeric_auto_selection_reject_inapplicable_frames() -> None:
    numeric = ordered_values()
    with pytest.raises(OperatorError, match="没有文本列"):
        run("text_transform", {}, numeric)
    target = replace(
        numeric, columns=(replace(numeric.columns[0], role="target"),)
    )
    with pytest.raises(OperatorError, match="非目标数值"):
        run("numeric_transform", {}, target)
    corrupted = replace(table(), rows=(("a", 1.0, 2.0, 3.0),), index=(1000,))
    with pytest.raises(OperatorError, match="混入"):
        run("text_transform", {"columns": ["label"]}, corrupted)
