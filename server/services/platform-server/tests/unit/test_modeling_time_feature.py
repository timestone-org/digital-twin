"""时间特征：第一个会增列、也是第一个推理时要时刻的算子。

⚠ 这一组同时是第二期那套入口契约的**验收**：造出来的列是派生列，入口契约必须
停在造它们之前——不然第三方会被要求提供一列管线自己会造的东西。
"""

from datetime import UTC, datetime
from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.frame import ROLE_FEATURE

KEY = "温度"
# 2026-01-05 是周一；UTC 01:00 在东八区是当天 09:00
MONDAY_UTC_MS = int(datetime(2026, 1, 5, 1, 0, tzinfo=UTC).timestamp() * 1000)
# 2026-01-10 是周六
SATURDAY_UTC_MS = int(
    datetime(2026, 1, 10, 1, 0, tzinfo=UTC).timestamp() * 1000
)
TZ_MINUTES = 480


def _frame(moments: list[int], *, extra: str | None = None) -> Frame:
    """一列温度，外加时间索引；`extra` 用来造列名冲突。

    Args: moments, extra。
    """
    columns = [
        FrameColumn(key=KEY, name=KEY, dtype="number", role=ROLE_FEATURE)
    ]
    if extra is not None:
        columns.append(FrameColumn(key=extra, name=extra, dtype="number"))
    rows = tuple(
        (float(index),) if extra is None else (float(index), 0.0)
        for index in range(len(moments))
    )
    return Frame(columns=tuple(columns), rows=rows, index=tuple(moments))


def _made(frame: Frame, *, tz: int = TZ_MINUTES, **config: Any) -> Frame:
    """跑一遍时间特征。

    Args: frame, tz, config。
    """
    operator, _ = registry.build("time_feature", config)
    operator.bind_runtime(tz_offset_minutes=tz, split_plan=None)
    produced = operator.run({"frame": frame})["frame"]
    assert isinstance(produced, Frame)
    return produced


def test_the_hour_is_the_local_one() -> None:
    """小时按业务时区算：UTC 01:00 在东八区是 9 点。

    ⚠ 按 UTC 算出来是 1，也在 0-23 之间，看不出错。
    """
    got = _made(_frame([MONDAY_UTC_MS]), parts=["hour"])
    assert got.values_of("ts_hour") == [9.0]


def test_the_same_moment_reads_differently_under_utc() -> None:
    """同一个时刻按 UTC 算是 1 点——这正是上一条要防的。"""
    got = _made(_frame([MONDAY_UTC_MS]), tz=0, parts=["hour"])
    assert got.values_of("ts_hour") == [1.0]


def test_the_weekday_and_weekend_flag_agree() -> None:
    """周一不是周末，周六是。"""
    got = _made(
        _frame([MONDAY_UTC_MS, SATURDAY_UTC_MS]),
        parts=["dayofweek", "is_weekend"],
    )
    assert got.values_of("ts_dayofweek") == [0.0, 5.0]
    assert got.values_of("ts_is_weekend") == [0.0, 1.0]


def test_the_original_columns_are_kept_in_order() -> None:
    """原有的列一列不动，造出来的接在后面。"""
    got = _made(_frame([MONDAY_UTC_MS]), parts=["hour", "month"])
    assert got.keys == (KEY, "ts_hour", "ts_month")


def test_the_declaration_matches_what_it_really_makes() -> None:
    """声明造哪几列，与真跑一遍造出来的一致。

    ⚠ 这条对不上时入口契约就错了，而两边各自看着都对
    （docs/MODELING_PLATFORM_DESIGN.md D3）。
    """
    operator = registry.get("time_feature")
    config = operator.CONFIG_MODEL.model_validate({"parts": ["hour", "month"]})
    declared = operator.describe_columns(config, {"frame": (KEY,)})
    got = _made(_frame([MONDAY_UTC_MS]), parts=["hour", "month"])
    assert declared["frame"] == got.keys


def test_the_same_part_twice_makes_one_column() -> None:
    """同一档配两遍只造一列。

    ⚠ 造两列同名的话，按 key 取值只取得到头一个，下游拿到哪一列全看运气。
    """
    got = _made(_frame([MONDAY_UTC_MS]), parts=["hour", "hour"])
    assert got.keys == (KEY, "ts_hour")


def test_a_name_clash_is_refused() -> None:
    """要造的列名已经被占了就当场说清楚，不硬造。"""
    frame = _frame([MONDAY_UTC_MS], extra="ts_hour")
    with pytest.raises(OperatorError, match="ts_hour"):
        _made(frame, parts=["hour"])


def test_data_without_a_moment_is_refused() -> None:
    """没有时刻时说清楚，不拿行号顶替。"""
    frame = Frame(
        columns=(FrameColumn(key=KEY, name=KEY, dtype="number"),),
        rows=((1.0,),),
    )
    with pytest.raises(OperatorError, match="时刻"):
        _made(frame, parts=["hour"])
