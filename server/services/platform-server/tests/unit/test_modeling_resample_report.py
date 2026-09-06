"""时间重采样的结果面：压缩比、桶占用与断档、每桶行数。

⚠ 这一组最要紧的一条是**时区跟着桶宽一起讲**：按 UTC 分桶与按东八区分桶差 8
小时，两者都不报错，而讲解里不带时区的话，界面上那条轴没人能核对。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    registry,
)
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.operators.resample import (
    BUCKET_SIZE_KEY,
    NOTE_NO_ROWS,
)
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES

KEY = "读数"
HOUR_MS = 3_600_000
DAY_MS = 86_400_000
# 东八区
TZ_MINUTES = 480
# 最坏负载：366 天逐时，且每 100 行断一次
YEAR_ROWS = 366 * 24


def frame_of(moments: list[int]) -> Frame:
    """一列数值，时刻按给定的那一串。

    Args: moments。
    """
    rows: tuple[tuple[CellValue, ...], ...] = tuple(
        (float(index),) for index in range(len(moments))
    )
    return Frame(
        columns=(FrameColumn(key=KEY, name=KEY, dtype="number"),),
        rows=rows,
        index=tuple(moments),
    )


def report_of(
    frame: Frame, *, tz: int = 0, **config: Any
) -> dict[str, ReportBlock]:
    """跑一遍重采样并把讲解按块种类归好。

    Args: frame, tz, config。
    """
    operator, _ = registry.build("resample", config)
    operator.bind_runtime(tz_offset_minutes=tz, split_plan=None)
    operator.run({"frame": frame})
    return {block.kind: block for block in operator.report()}


def stages_of(frame: Frame, **config: Any) -> dict[str, dict[str, Any]]:
    """压缩比那一块的漏斗。

    Args: frame, config。
    """
    rows = report_of(frame, **config)["rows"]
    stages: list[dict[str, Any]] = rows.payload["funnel"]
    return {stage["name"]: stage for stage in stages}


def test_a_resample_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲——空壳会让界面摆出一片空白的分区。"""
    operator, _ = registry.build("resample", {"bucket": "1h"})
    assert operator.report() == ()


def test_the_compression_ratio_counts_rows_in_against_buckets_out() -> None:
    """四小时里的十六行按小时折成四行，压缩比是四分之一。"""
    moments = [index * HOUR_MS // 4 for index in range(16)]
    rows = report_of(frame_of(moments), bucket="1h")["rows"]
    assert rows.payload["before"] == 16
    assert rows.payload["after"] == 4
    assert rows.payload["ratio_actual"] == 0.25


def test_folding_rows_together_is_not_dropping_them() -> None:
    """折进桶里的行一行都没丢——记成丢弃会让界面说这一步丢了数据。"""
    moments = [index * HOUR_MS // 4 for index in range(16)]
    rows = report_of(frame_of(moments), bucket="1h")["rows"]
    assert rows.payload["dropped"] == 0
    assert rows.payload["ratio_configured"] is None


def test_the_funnel_separates_the_empty_buckets_from_the_occupied_ones() -> (
    None
):
    """第 0、1、3 小时各一行：横跨四个桶，三个有数据，一个是空的。"""
    stages = stages_of(frame_of([0, HOUR_MS, 3 * HOUR_MS]), bucket="1h")
    assert stages["时段内的桶"]["value"] == 4
    assert stages["有数据的桶"]["value"] == 3
    assert stages["空桶"]["value"] == 1


def test_an_empty_frame_says_the_bucket_count_is_unknown_not_zero() -> None:
    """一行都没进来时桶的账算不出来，那是「不知道」不是「零个」。"""
    stages = stages_of(frame_of([]), bucket="1h")
    assert stages["时段内的桶"]["value"] is None
    assert stages["时段内的桶"]["note"] == NOTE_NO_ROWS
    assert stages["空桶"]["value"] is None


def test_the_axis_carries_the_business_time_zone_it_bucketed_by() -> None:
    """东八区里的「一天」从当地零点起，那是 UTC 的前一天 16 点。"""
    axis = report_of(frame_of([20 * HOUR_MS]), tz=TZ_MINUTES, bucket="1d")[
        "axis"
    ]
    assert axis.payload["tz_offset_minutes"] == TZ_MINUTES
    assert axis.payload["actual_since"] == "1970-01-01T16:00:00+00:00"


def test_the_same_rows_bucketed_by_utc_land_on_another_day() -> None:
    """同一行按 UTC 切落在另一个桶上——不带时区的讲解分不出这两张轴。"""
    axis = report_of(frame_of([20 * HOUR_MS]), tz=0, bucket="1d")["axis"]
    assert axis.payload["tz_offset_minutes"] == 0
    assert axis.payload["actual_since"] == "1970-01-01T00:00:00+00:00"


def test_the_axis_names_the_bucket_width_in_milliseconds() -> None:
    """桶宽跟着轴走：光有占用率，界面说不出一格是多久。"""
    axis = report_of(frame_of([0, HOUR_MS]), bucket="1h")["axis"]
    assert axis.payload["bucket_ms"] == HOUR_MS


def test_a_gap_is_measured_in_the_buckets_that_have_no_row() -> None:
    """第 3 小时到第 20 小时之间断了 16 个桶。"""
    moments = [0, HOUR_MS, 2 * HOUR_MS, 3 * HOUR_MS, 20 * HOUR_MS]
    axis = report_of(frame_of(moments), bucket="1h")["axis"]
    gaps: list[dict[str, Any]] = axis.payload["gaps"]
    assert gaps[0]["since"] == 3 * HOUR_MS
    assert gaps[0]["until"] == 20 * HOUR_MS
    assert gaps[0]["missing"] == 16


def test_the_bucket_sizes_land_in_a_histogram() -> None:
    """两个四行桶、一个单行桶：轴从 1 铺到 4，两端各站着它们。"""
    moments = [0, 0, 0, 0, HOUR_MS, HOUR_MS, HOUR_MS, HOUR_MS, 2 * HOUR_MS]
    column = report_of(frame_of(moments), bucket="1h")["bins"].payload[
        "by_column"
    ][0]
    assert column["key"] == BUCKET_SIZE_KEY
    assert column["low"] == 1.0
    assert column["high"] == 4.0
    assert column["bins"][0] == 1.0
    assert column["bins"][-1] == 2.0
    assert sum(column["bins"]) == 3.0


def test_the_single_row_buckets_get_a_warning_line() -> None:
    """单行桶有两个，警示线画在 1 那一柱上并把个数写进标签。"""
    moments = [0, 0, HOUR_MS, 2 * HOUR_MS]
    column = report_of(frame_of(moments), bucket="1h")["bins"].payload[
        "by_column"
    ][0]
    assert column["marks"] == [
        {"at": 1.0, "label": "单行桶 2 个", "intent": "warning"}
    ]


def test_no_warning_line_when_every_bucket_holds_more_than_one_row() -> None:
    """一个单行桶都没有就不画那条线：空柱与没有单行桶长得一模一样。"""
    moments = [0, 0, HOUR_MS, HOUR_MS]
    column = report_of(frame_of(moments), bucket="1h")["bins"].payload[
        "by_column"
    ][0]
    assert column["marks"] == []


def broken_frame() -> Frame:
    """最坏负载：366 天逐时，每 100 行断开十小时。"""
    return frame_of(
        [
            index * HOUR_MS + (index // 100) * 10 * HOUR_MS
            for index in range(YEAR_ROWS)
        ]
    )


def test_the_worst_load_still_fits_the_report_budget() -> None:
    """366 天逐时、逐分钟分桶：讲解装得下，一块都不用降档丢掉。"""
    operator, _ = registry.build("resample", {"bucket": "1m"})
    operator.bind_runtime(tz_offset_minutes=TZ_MINUTES, split_plan=None)
    operator.run({"frame": broken_frame()})
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def test_the_worst_load_keeps_the_occupancy_and_the_gaps_within_bounds() -> (
    None
):
    """占用率折成 200 格、断档只留最长的 20 条，图才画得下。"""
    axis = report_of(broken_frame(), bucket="1m")["axis"]
    assert len(axis.payload["occupancy"]) == 200
    assert len(axis.payload["gaps"]) == 20


@pytest.mark.parametrize(
    ("bucket", "width"),
    [
        ("1m", 60_000),
        ("5m", 300_000),
        ("15m", 900_000),
        ("1h", 3_600_000),
        ("6h", 21_600_000),
        ("1d", 86_400_000),
    ],
)
def test_every_bucket_width_reaches_the_axis(bucket: str, width: int) -> None:
    """六档桶宽都得原样出现在轴上，界面照它标刻度。

    Args: bucket, width。
    """
    axis = report_of(frame_of([0, DAY_MS]), bucket=bucket)["axis"]
    assert axis.payload["bucket_ms"] == width
