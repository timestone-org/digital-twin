"""半小时预测的时间对齐、周期编码和历史输入契约。"""

import math
from dataclasses import replace
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    Provenance,
    registry,
)

MINUTE = 60_000
DAY = 1440 * MINUTE


def source() -> Frame:
    return Frame(
        columns=(
            FrameColumn(key="负荷", name="平均负荷", dtype="number", unit="kW"),
        ),
        rows=((0.0,), (20.0,), (None,)),
        index=(0, 30 * MINUTE, 90 * MINUTE),
        provenance=Provenance(
            table_codes=("load",),
            since=datetime.fromtimestamp(0, UTC),
            until=datetime.fromtimestamp(7200, UTC),
            is_truncated=True,
        ),
    )


def run(code: str, frame: Frame, config: dict[str, object]) -> Frame:
    operator, _ = registry.build(code, config)
    result = operator.run({"frame": frame})["frame"]
    assert isinstance(result, Frame)
    return result


def test_shift_keeps_values_units_and_source_but_moves_time_window() -> None:
    original = source()
    shifted = run("time_shift", original, {"offset_minutes": 1440})
    assert shifted.index == (DAY, DAY + 30 * MINUTE, DAY + 90 * MINUTE)
    assert shifted.rows == ((0.0,), (20.0,), (None,))
    assert shifted.columns == original.columns
    assert shifted.provenance == Provenance(
        table_codes=("load",),
        since=datetime(1970, 1, 2, tzinfo=UTC),
        until=datetime(1970, 1, 2, 2, tzinfo=UTC),
        is_truncated=True,
    )
    assert original.index == (0, 30 * MINUTE, 90 * MINUTE)


def test_exact_join_preserves_gap_instead_of_using_previous_row() -> None:
    shifted = run("time_shift", source(), {})
    targets = replace(
        source(), index=(DAY, DAY + 60 * MINUTE, DAY + 90 * MINUTE)
    )
    operator, _ = registry.build(
        "ledger_join", {"how": "left", "tolerance_ms": 0}
    )
    result = operator.run({"left": targets, "right": shifted})["frame"]
    assert isinstance(result, Frame)
    assert result.rows == ((0.0, 0.0), (20.0, None), (None, None))


def test_shift_moves_the_observation_cutoff_with_the_bucket_timestamps() -> (
    None
):
    original = source()
    frame = replace(
        original,
        provenance=replace(
            original.provenance,
            observed_until=datetime.fromtimestamp(45 * 60, UTC),
            is_truncated=False,
        ),
    )
    shifted = run("time_shift", frame, {"offset_minutes": 1440})
    assert shifted.provenance.observed_until == datetime(
        1970, 1, 2, 0, 45, tzinfo=UTC
    )
    result = run(
        "resample",
        shifted,
        {"bucket": "30m", "should_keep_complete_buckets": True},
    )
    assert result.index == (DAY,)
    assert result.rows == ((0.0,),)


def test_half_hour_average_excludes_an_unfinished_bucket() -> None:
    original = source()
    frame = replace(
        original,
        index=(0, 15 * MINUTE, 30 * MINUTE),
        provenance=replace(
            original.provenance,
            until=datetime.fromtimestamp(45 * 60, UTC),
            is_truncated=False,
        ),
    )
    result = run(
        "resample",
        frame,
        {"bucket": "30m", "agg": "avg", "should_keep_complete_buckets": True},
    )
    assert result.index == (0,)
    assert result.rows == ((10.0,),)
    assert result.columns[0].unit == "kW"


@pytest.mark.parametrize("offset", [0, -30, 43201, 0.5, True])
def test_shift_rejects_non_positive_or_unbounded_offsets(
    offset: object,
) -> None:
    with pytest.raises(ValidationError):
        registry.build("time_shift", {"offset_minutes": offset})


@pytest.mark.parametrize("code", ["time_shift", "cyclic_time"])
@pytest.mark.parametrize("index", [None, (0,)])
def test_time_operations_require_an_index_for_each_row(
    code: str, index: tuple[int, ...] | None
) -> None:
    with pytest.raises(OperatorError, match=r"时刻|长度"):
        run(code, replace(source(), index=index), {})


@pytest.mark.parametrize("index", [(0, 0, 1), (2, 1, 0)])
def test_shift_refuses_ambiguous_or_unsorted_history(
    index: tuple[int, ...],
) -> None:
    with pytest.raises(OperatorError, match="唯一"):
        run("time_shift", replace(source(), index=index), {})


def test_shift_rejects_datetime_overflow() -> None:
    frame = replace(
        source(), provenance=Provenance(until=datetime.max.replace(tzinfo=UTC))
    )
    with pytest.raises(OperatorError, match="范围"):
        run("time_shift", frame, {})


@pytest.mark.parametrize("code", ["time_shift", "cyclic_time"])
def test_empty_frames_with_an_empty_index_are_supported(code: str) -> None:
    result = run(code, Frame(columns=source().columns, rows=(), index=()), {})
    assert result.row_count == 0
    assert result.index == ()
    assert result.provenance == Provenance()


def test_day_cycle_respects_half_hours_midnight_and_explicit_timezone() -> None:
    frame = replace(
        source(),
        index=(16 * 60 * MINUTE, (16 * 60 + 30) * MINUTE, 22 * 60 * MINUTE),
    )
    result = run(
        "cyclic_time",
        frame,
        {"cycles": ["day"], "timezone_offset_minutes": 480},
    )
    assert result.rows[0][1:] == pytest.approx((0.0, 1.0))
    assert result.rows[1][1:] == pytest.approx((0.1305261922, 0.9914448614))
    assert result.rows[2][1:] == pytest.approx((1.0, 0.0))
    assert result.columns[0].unit == "kW"
    assert all(column.unit == "" for column in result.columns[1:])
    assert result.index == frame.index
    assert result.provenance == frame.provenance


def test_week_cycle_starts_on_monday_and_wraps_after_seven_days() -> None:
    frame = replace(source(), index=(4 * DAY, 11 * DAY, -3 * DAY))
    result = run(
        "cyclic_time", frame, {"cycles": ["week"], "timezone_offset_minutes": 0}
    )
    for row in result.rows:
        assert row[1:] == pytest.approx((0.0, 1.0))


@pytest.mark.parametrize(
    "config",
    [
        {"cycles": []},
        {"cycles": ["day", "day"]},
        {"cycles": ["month"]},
        {"timezone_offset_minutes": 841},
        {"timezone_offset_minutes": -841},
        {"timezone_offset_minutes": True},
    ],
)
def test_cyclic_config_refuses_invalid_cycles_and_offsets(
    config: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        registry.build("cyclic_time", config)


def test_cyclic_columns_cannot_overwrite_source_columns() -> None:
    frame = replace(
        source(),
        columns=(FrameColumn(key="ts_day_sin", name="碰撞", dtype="number"),),
    )
    with pytest.raises(OperatorError, match="已存在"):
        run("cyclic_time", frame, {})


def test_static_columns_match_runtime_and_unknown_input_stays_unknown() -> None:
    operator, config = registry.build(
        "cyclic_time", {"cycles": ["week", "day"]}
    )
    assert operator.describe_columns(config, {"frame": None}) == {"frame": None}
    declared = operator.describe_columns(config, {"frame": source().keys})
    result = operator.run({"frame": source()})["frame"]
    assert declared == {"frame": result.keys}
    assert result.keys == (
        "负荷",
        "ts_week_sin",
        "ts_week_cos",
        "ts_day_sin",
        "ts_day_cos",
    )


def test_cycle_values_are_periodic_and_never_change_with_runtime_timezone() -> (
    None
):
    operator, _ = registry.build("cyclic_time", {"cycles": ["day"]})
    operator.bind_runtime(tz_offset_minutes=-300, split_plan=None)
    first = operator.run({"frame": source()})["frame"]
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    second = operator.run({"frame": source()})["frame"]
    assert first == second
    assert first.rows[0][1:] == pytest.approx((math.sqrt(3) / 2, -0.5))
