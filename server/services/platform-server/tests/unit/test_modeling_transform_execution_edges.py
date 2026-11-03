"""转换执行链中的选择范围与非有限文本数值边界。"""

import math

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)


def sparse_columns() -> Frame:
    return Frame(
        columns=(
            FrameColumn(key="selected", name="选中列", dtype="number"),
            FrameColumn(key="unselected", name="未选列", dtype="number"),
            FrameColumn(key="stable", name="完整列", dtype="number"),
        ),
        rows=((None, None, 1.0), (None, None, 2.0), (3.0, None, 3.0)),
        index=(1000, 2000, 3000),
    )


def test_column_missing_filter_preserves_unselected_columns() -> None:
    source = sparse_columns()
    operator, _ = registry.build(
        "drop_missing",
        {"axis": "col", "subset": ["selected"], "max_null_ratio": 0.5},
    )
    result = operator.run({"frame": source})["frame"]
    assert isinstance(result, Frame)
    assert result.keys == ("unselected", "stable")
    assert result.rows == ((None, 1.0), (None, 2.0), (None, 3.0))
    assert result.index == source.index
    charts = [block for block in operator.report() if block.kind == "bins"]
    assert charts
    assert [column["key"] for column in charts[0].payload["by_column"]] == [
        "selected"
    ]
    rows = next(block for block in operator.report() if block.kind == "rows")
    stages = {stage["name"]: stage["value"] for stage in rows.payload["funnel"]}
    assert stages["进来"] == 3
    assert stages["留下"] == 2


def test_column_missing_filter_rejects_an_unknown_selection() -> None:
    operator, _ = registry.build(
        "drop_missing", {"axis": "col", "subset": ["absent"]}
    )
    with pytest.raises(OperatorError, match="没有列"):
        operator.run({"frame": sparse_columns()})


def nonfinite_text() -> Frame:
    return Frame(
        columns=(FrameColumn(key="value", name="文本读数", dtype="string"),),
        rows=(("NaN",), ("Inf",), ("-inf",), ("1e9999",), ("2.5",)),
    )


def test_numeric_casts_treat_nonfinite_text_as_conversion_failure() -> None:
    operator, _ = registry.build(
        "cast_type",
        {"columns": ["value"], "to": "number", "on_error": "coerce"},
    )
    result = operator.run({"frame": nonfinite_text()})["frame"]
    assert isinstance(result, Frame)
    assert result.values_of("value") == [None, None, None, None, 2.5]
    assert all(
        value is None or (isinstance(value, float) and math.isfinite(value))
        for value in result.values_of("value")
    )


def test_casting_nonfinite_text_can_fail_loudly() -> None:
    operator, _ = registry.build(
        "cast_type", {"columns": ["value"], "to": "number", "on_error": "error"}
    )
    with pytest.raises(OperatorError, match="转不成"):
        operator.run({"frame": nonfinite_text()})


@pytest.mark.parametrize("stat", ["mean", "sum", "min", "max", "std"])
@pytest.mark.parametrize("column", ["value", "sensor@east"])
def test_rolling_statistics_retain_the_measurement_unit(
    stat: str, column: str
) -> None:
    source = Frame(
        columns=(
            FrameColumn(key=column, name="能耗", dtype="number", unit="kWh"),
        ),
        rows=((1.0,), (3.0,)),
        index=(0, 1000),
    )
    operator, _ = registry.build(
        "rolling_feature", {"columns": [column], "window": 2, "stats": [stat]}
    )
    result = operator.run({"frame": source})["frame"]
    assert isinstance(result, Frame)
    assert result.column_of(f"{column}@{stat}2").unit == "kWh"
