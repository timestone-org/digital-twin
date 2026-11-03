"""三十个转换算子的确定性输入与独立手算结果。"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    Provenance,
)

MINUTE = 60_000
HOUR = 60 * MINUTE
PROVENANCE = Provenance(
    table_codes=("execution_audit",),
    since=datetime(1970, 1, 1, tzinfo=UTC),
    until=datetime(1970, 1, 2, tzinfo=UTC),
)


@dataclass(frozen=True)
class ExecutionCase:
    code: str
    config: dict[str, object]
    inputs: dict[str, Frame]
    expected: Frame


def matrix(
    keys: tuple[str, ...],
    rows: tuple[tuple[CellValue, ...], ...],
    *,
    should_index: bool = True,
) -> Frame:
    columns: list[FrameColumn] = []
    for seat, key in enumerate(keys):
        sample = next((row[seat] for row in rows if row[seat] is not None), 0.0)
        dtype = "string" if isinstance(sample, str) else "number"
        columns.append(
            FrameColumn(
                key=key,
                name=key,
                dtype=dtype,
                role="target" if key == "target" else "feature",
                unit="kWh" if key == "value" else "",
            )
        )
    return Frame(
        columns=tuple(columns),
        rows=rows,
        index=(
            tuple(seat * MINUTE for seat in range(len(rows)))
            if should_index
            else None
        ),
        provenance=PROVENANCE,
    )


def numbers(values: Sequence[CellValue]) -> Frame:
    return matrix(("value",), tuple((value,) for value in values))


def unary(
    code: str, config: dict[str, object], source: Frame, expected: Frame
) -> ExecutionCase:
    return ExecutionCase(code, config, {"frame": source}, expected)


def cleaning_cases() -> tuple[ExecutionCase, ...]:
    source = numbers([1.0, None, 3.0])
    two = replace(numbers([1.0, 3.0]), index=(0, 2 * MINUTE))
    selected = matrix(("value", "other"), ((1.0, 10.0), (2.0, 20.0)))
    return (
        unary(
            "cast_type",
            {"columns": ["value"], "to": "number"},
            numbers(["1", "bad", "3"]),
            source,
        ),
        unary("drop_missing", {"subset": ["value"]}, source, two),
        unary(
            "fill_missing",
            {"columns": ["value"], "strategy": "mean"},
            source,
            numbers([1.0, 2.0, 3.0]),
        ),
        unary(
            "filter_rows",
            {"column": "value", "op": "gte", "value": 2.0},
            numbers([1.0, 2.0, 3.0]),
            replace(numbers([2.0, 3.0]), index=(MINUTE, 2 * MINUTE)),
        ),
        unary(
            "select_columns",
            {"columns": ["other", "value"]},
            selected,
            matrix(("other", "value"), ((10.0, 1.0), (20.0, 2.0))),
        ),
    )


def row_cases() -> tuple[ExecutionCase, ...]:
    source = numbers([1.0, 2.0, 3.0])
    return (
        unary(
            "deduplicate",
            {},
            numbers([1.0, 1.0, None, 3.0]),
            replace(
                numbers([1.0, None, 3.0]), index=(0, 2 * MINUTE, 3 * MINUTE)
            ),
        ),
        unary(
            "sort_rows",
            {"columns": ["value"], "direction": "descending"},
            source,
            replace(numbers([3.0, 2.0, 1.0]), index=(2 * MINUTE, MINUTE, 0)),
        ),
        unary(
            "sample_rows",
            {"method": "head", "size_mode": "count", "count": 2},
            source,
            numbers([1.0, 2.0]),
        ),
        unary(
            "replace_values",
            {"match": 2.0, "replacement": 0.0},
            source,
            numbers([1.0, 0.0, 3.0]),
        ),
        unary(
            "rank_rows",
            {"column": "value", "method": "min"},
            source,
            matrix(("value", "rank"), ((1.0, 3.0), (2.0, 2.0), (3.0, 1.0))),
        ),
    )


def combination_cases() -> tuple[ExecutionCase, ...]:
    left = matrix(("category", "value"), (("a", 1.0), ("b", 2.0), (None, 3.0)))
    right = matrix(("key", "factor"), (("a", 10.0), ("b", 20.0), (None, 30.0)))
    grouped = matrix(
        ("value", "category"),
        ((1.0, "a"), (3.0, "a"), (None, "b"), (4.0, None)),
    )
    concat = replace(numbers([1.0, 2.0, 3.0]), index=(0, MINUTE, 0))
    return (
        ExecutionCase(
            "concat_rows",
            {},
            {"left": numbers([1.0, 2.0]), "right": numbers([3.0])},
            concat,
        ),
        ExecutionCase(
            "key_join",
            {"left_key": "category", "right_key": "key"},
            {"left": left, "right": right},
            matrix(
                ("category", "value", "right_key", "right_factor"),
                (
                    ("a", 1.0, "a", 10.0),
                    ("b", 2.0, "b", 20.0),
                    (None, 3.0, None, None),
                ),
            ),
        ),
        unary(
            "group_aggregate",
            {"group_columns": ["category"], "columns": ["value"], "agg": "avg"},
            grouped,
            matrix(
                ("category", "value_avg"),
                (("a", 2.0), ("b", None), (None, 4.0)),
                should_index=False,
            ),
        ),
    )


def preparation_cases() -> tuple[ExecutionCase, ...]:
    shifted = replace(
        numbers([1.0, 2.0, 3.0]),
        index=(HOUR, HOUR + MINUTE, HOUR + 2 * MINUTE),
        provenance=replace(
            PROVENANCE,
            since=datetime(1970, 1, 1, 1, tzinfo=UTC),
            until=datetime(1970, 1, 2, 1, tzinfo=UTC),
        ),
    )
    sampled = replace(
        numbers([1.0, 2.0, 3.0, 4.0]), index=(0, MINUTE, 5 * MINUTE, 6 * MINUTE)
    )
    return (
        unary(
            "resample",
            {"bucket": "5m", "agg": "sum"},
            sampled,
            replace(numbers([3.0, 7.0]), index=(0, 5 * MINUTE)),
        ),
        unary(
            "time_shift",
            {"offset_minutes": 60},
            numbers([1.0, 2.0, 3.0]),
            shifted,
        ),
        unary(
            "text_transform",
            {"columns": ["value"], "method": "strip"},
            numbers([" A ", "B ", None]),
            numbers(["A", "B", None]),
        ),
    )


def numeric_cases() -> tuple[ExecutionCase, ...]:
    return (
        unary(
            "binning",
            {"boundaries": [0.0, 10.0]},
            numbers([0.0, 1.0, 10.0]),
            matrix(
                ("value", "value_bin"), ((0.0, 0.0), (1.0, 1.0), (10.0, 1.0))
            ),
        ),
        unary(
            "column_math",
            {"left_column": "value", "method": "multiply", "constant": 2.0},
            numbers([1.0, 2.0, None]),
            matrix(
                ("value", "calculated"), ((1.0, 2.0), (2.0, 4.0), (None, None))
            ),
        ),
        unary(
            "cumulative_stats",
            {},
            numbers([1.0, None, 3.0]),
            matrix(
                ("value", "value_cumulative"),
                ((1.0, 1.0), (None, None), (3.0, 4.0)),
            ),
        ),
        unary(
            "difference",
            {},
            numbers([1.0, 2.0, 4.0]),
            matrix(
                ("value", "value_change"), ((1.0, None), (2.0, 1.0), (4.0, 2.0))
            ),
        ),
        unary(
            "numeric_transform",
            {"method": "square"},
            numbers([1.0, -2.0, 3.0]),
            numbers([1.0, 4.0, 9.0]),
        ),
    )


def clock_cases() -> tuple[ExecutionCase, ...]:
    source = replace(numbers([1.0, 2.0, 3.0]), index=(0, 6 * HOUR, 12 * HOUR))
    cyclic = replace(
        matrix(
            ("value", "ts_day_sin", "ts_day_cos"),
            ((1.0, 0.0, 1.0), (2.0, 1.0, 0.0), (3.0, 0.0, -1.0)),
        ),
        index=source.index,
    )
    clock = replace(
        matrix(
            (
                "value",
                "ts_hour",
                "ts_dayofweek",
                "ts_month",
                "ts_dayofyear",
                "ts_is_weekend",
            ),
            (
                (1.0, 0.0, 3.0, 1.0, 1.0, 0.0),
                (2.0, 6.0, 3.0, 1.0, 1.0, 0.0),
                (3.0, 12.0, 3.0, 1.0, 1.0, 0.0),
            ),
        ),
        index=source.index,
    )
    return (
        unary(
            "cyclic_time",
            {"cycles": ["day"], "timezone_offset_minutes": 0},
            source,
            cyclic,
        ),
        unary(
            "time_feature",
            {
                "parts": [
                    "hour",
                    "dayofweek",
                    "month",
                    "dayofyear",
                    "is_weekend",
                ]
            },
            source,
            clock,
        ),
    )


def window_cases() -> tuple[ExecutionCase, ...]:
    source = numbers([1.0, 2.0, 3.0])
    rolling = matrix(
        (
            "value",
            "value@mean2",
            "value@sum2",
            "value@min2",
            "value@max2",
            "value@std2",
        ),
        (
            (1.0, None, None, None, None, None),
            (2.0, 1.5, 3.0, 1.0, 2.0, 0.5),
            (3.0, 2.5, 5.0, 2.0, 3.0, 0.5),
        ),
    )
    return (
        unary(
            "lag_feature",
            {"columns": ["value"], "lags": [1]},
            source,
            matrix(
                ("value", "value@lag1"), ((1.0, None), (2.0, 1.0), (3.0, 2.0))
            ),
        ),
        unary(
            "rolling_feature",
            {
                "columns": ["value"],
                "window": 2,
                "stats": ["mean", "sum", "min", "max", "std"],
            },
            source,
            rolling,
        ),
    )


def fitted_cases() -> tuple[ExecutionCase, ...]:
    selected = matrix(
        ("value", "other", "target"),
        ((1.0, 8.0, 11.0), (2.0, 8.0, 12.0), (3.0, 8.0, 13.0)),
    )
    return (
        unary(
            "clip_outlier",
            {"columns": ["value"], "method": "zscore", "threshold": 1.0},
            numbers([0.0, 0.0, 0.0, 4.0]),
            numbers([0.0, 0.0, 0.0, 1 + math.sqrt(3)]),
        ),
        unary(
            "one_hot",
            {"columns": ["value"]},
            numbers(["a", "b", "a"]),
            matrix(
                ("value=a", "value=b"), ((1.0, 0.0), (0.0, 1.0), (1.0, 0.0))
            ),
        ),
        unary(
            "pca",
            {"columns": ["value", "other"], "n_components": 1},
            matrix(("value", "other"), ((-1.0, -2.0), (0.0, 0.0), (1.0, 2.0))),
            matrix(("pc1",), ((-math.sqrt(5),), (0.0,), (math.sqrt(5),))),
        ),
        unary(
            "select_feature",
            {"columns": ["value", "other"], "method": "variance", "top_k": 1},
            selected,
            matrix(
                ("value", "target"), ((1.0, 11.0), (2.0, 12.0), (3.0, 13.0))
            ),
        ),
        unary(
            "standardize",
            {"columns": ["value"], "method": "minmax"},
            numbers([1.0, 2.0, 3.0]),
            numbers([0.0, 0.5, 1.0]),
        ),
    )


def execution_cases() -> tuple[ExecutionCase, ...]:
    return (
        *cleaning_cases(),
        *row_cases(),
        *combination_cases(),
        *preparation_cases(),
        *numeric_cases(),
        *clock_cases(),
        *window_cases(),
        *fitted_cases(),
    )
