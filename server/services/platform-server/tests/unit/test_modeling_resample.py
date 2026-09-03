"""时间重采样：桶按业务时区对齐、空桶不补行、八档聚合各自算对。

⚠ 这一组最要紧的两条都与「看着正常的错数」有关：按 UTC 切「一天」在东八区会
整体偏 8 小时，而每个数看起来都合理；空桶补一行会把「没测到」变成一个真实取值。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    AGG_FUNCS,
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)

KEY = "读数"
LABEL = "标记"
HOUR_MS = 3_600_000
DAY_MS = 86_400_000
# 东八区
TZ_MINUTES = 480


def _frame(
    rows: list[tuple[float | None, str | None]], index: list[int] | None
) -> Frame:
    """一列数值、一列文本，外加时间索引。

    Args: rows, index。
    """
    return Frame(
        columns=(
            FrameColumn(key=KEY, name=KEY, dtype="number"),
            FrameColumn(key=LABEL, name=LABEL, dtype="string"),
        ),
        rows=tuple(rows),
        index=None if index is None else tuple(index),
    )


def _resampled(frame: Frame, *, tz: int = 0, **config: Any) -> Frame:
    """跑一遍重采样。

    Args: frame, tz, config。
    """
    operator, _ = registry.build("resample", config)
    operator.bind_runtime(tz_offset_minutes=tz, split_plan=None)
    produced = operator.run({"frame": frame})["frame"]
    assert isinstance(produced, Frame)
    return produced


def test_rows_in_the_same_hour_fold_into_one() -> None:
    """同一小时内的行合成一行，索引是桶的起点。"""
    frame = _frame(
        [(1.0, "甲"), (3.0, "乙"), (10.0, "丙")],
        [0, HOUR_MS // 2, HOUR_MS],
    )
    got = _resampled(frame, bucket="1h", agg="avg")
    assert got.row_count == 2
    assert got.values_of(KEY) == [2.0, 10.0]
    assert got.index == (0, HOUR_MS)


def test_an_empty_stretch_produces_no_row() -> None:
    """中间那一段没有数据就是没有，不凭空补一行。

    ⚠ 补一行会把「没测到」变成一个真实取值，而下游看不出区别。
    """
    frame = _frame([(1.0, "甲"), (2.0, "乙")], [0, HOUR_MS * 5])
    got = _resampled(frame, bucket="1h", agg="avg")
    assert got.row_count == 2
    assert got.index == (0, HOUR_MS * 5)


def test_the_day_bucket_aligns_to_the_business_timezone() -> None:
    """东八区的「一天」从当地零点起算，不是 UTC 零点。

    ⚠ 按 UTC 切会整体偏 8 小时，而算出来的每个数看着都正常。
    """
    # UTC 的 16:00 与 17:00 在东八区已经是第二天的 00:00 与 01:00
    frame = _frame([(1.0, "甲"), (2.0, "乙")], [HOUR_MS * 16, HOUR_MS * 17])
    same_day = _resampled(frame, bucket="1d", agg="avg", tz=TZ_MINUTES)
    assert same_day.row_count == 1
    assert same_day.index == (DAY_MS - TZ_MINUTES * 60_000,)


def test_the_same_rows_split_in_two_under_utc() -> None:
    """同一份数据按 UTC 切会落进两天——这正是上一条要防的。"""
    frame = _frame([(1.0, "甲"), (2.0, "乙")], [HOUR_MS * 23, HOUR_MS * 25])
    assert _resampled(frame, bucket="1d", agg="avg", tz=0).row_count == 2


@pytest.mark.parametrize(
    ("agg", "expected"),
    [
        ("avg", 3.0),
        ("sum", 9.0),
        ("min", 1.0),
        ("max", 5.0),
        ("first", 1.0),
        ("last", 5.0),
        ("delta", 4.0),
        ("count", 3.0),
    ],
)
def test_each_aggregation_folds_the_bucket_its_own_way(
    agg: str, expected: float
) -> None:
    """八档各自手算核对。

    Args: agg, expected。
    """
    frame = _frame([(1.0, "甲"), (3.0, "乙"), (5.0, "丙")], [0, 1000, 2000])
    got = _resampled(frame, bucket="1h", agg=agg)
    assert got.values_of(KEY) == [expected]


def test_every_aggregation_in_the_roster_really_folds() -> None:
    """名单里的每一档都要真的算得出来。

    ⚠ 折算写成一张表之后，漏掉哪一档只有这条用例逮得到——少一个键就 KeyError。
    """
    frame = _frame([(1.0, "甲"), (2.0, "乙")], [0, 1000])
    for agg in AGG_FUNCS:
        assert _resampled(frame, bucket="1h", agg=agg).row_count == 1


def test_a_blank_does_not_drag_the_average_down() -> None:
    """空值不参与聚合，也不被当成 0。"""
    frame = _frame([(4.0, "甲"), (None, "乙")], [0, 1000])
    assert _resampled(frame, bucket="1h", agg="avg").values_of(KEY) == [4.0]


def test_a_bucket_with_only_blanks_stays_blank() -> None:
    """整桶都是空值时那一格还是空的，不是 0。"""
    frame = _frame([(None, "甲"), (None, "乙")], [0, 1000])
    assert _resampled(frame, bucket="1h", agg="avg").values_of(KEY) == [None]


def test_a_text_column_takes_the_last_value_in_the_bucket() -> None:
    """非数值列一律取桶内最后一个非空取值——平均对文本没有意义。"""
    frame = _frame([(1.0, "甲"), (2.0, None), (3.0, "丙")], [0, 1000, 2000])
    assert _resampled(frame, bucket="1h", agg="sum").values_of(LABEL) == ["丙"]


def test_data_without_a_timestamp_is_refused() -> None:
    """没有时间索引时说清楚，不按行号硬分桶。"""
    with pytest.raises(OperatorError, match="时间索引"):
        _resampled(_frame([(1.0, "甲")], None), bucket="1h", agg="avg")
