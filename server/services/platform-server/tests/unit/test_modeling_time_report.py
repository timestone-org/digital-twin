"""时间特征的结果面：新增列、时区口径、各档取值分布。

⚠ 这一份反复验的是**时区**：按 UTC 与按东八区造出来的列长得一模一样，而每个数
差着 8 小时（docs/MODELING_RESULT_VIEW_DESIGN.md §5-13）。
"""

from datetime import UTC, datetime
from typing import Any

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    registry,
)
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.operators.timeblocks import TZ_ALERT
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES

# 最坏负载：366 天逐时，五档全开
YEAR_ROWS = 366 * 24
HOUR_MS = 3600 * 1000
ALL_PARTS = ["hour", "dayofweek", "month", "dayofyear", "is_weekend"]
# 五档逐格摊开一共这么多项，刚好压在按项的上限 60 之下
ALL_BUCKETS = 24 + 7 + 12 + 12 + 2


def moment_at(year: int, month: int, day: int, hour: int = 0) -> int:
    """一个 UTC 时刻的毫秒数。

    Args: year, month, day, hour。
    """
    return int(datetime(year, month, day, hour, tzinfo=UTC).timestamp() * 1000)


def frame_at(moments: list[int]) -> Frame:
    """一列数值 + 一条时刻索引。

    Args: moments。
    """
    return Frame(
        columns=(FrameColumn(key="温度", name="温度", dtype="number"),),
        rows=tuple((float(seat),) for seat in range(len(moments))),
        index=tuple(moments),
    )


def blocks_of(
    frame: Frame, *, tz: int = 480, parts: list[str] | None = None
) -> dict[str, ReportBlock]:
    """跑一遍时间特征，回按种类归好的讲解。

    Args: frame, tz, parts。
    """
    operator, _ = registry.build("time_feature", {"parts": parts or ["hour"]})
    operator.bind_runtime(tz_offset_minutes=tz, split_plan=None)
    operator.run({"frame": frame})
    return {block.kind: block for block in operator.report()}


def items_of(blocks: dict[str, ReportBlock]) -> list[dict[str, Any]]:
    """各档取值分布里的每一条。

    Args: blocks。
    """
    listed: list[dict[str, Any]] = blocks["breakdown"].payload["items"]
    return listed


def item_of(blocks: dict[str, ReportBlock], name: str) -> dict[str, Any]:
    """分布里叫这个名字的那一条。

    Args: blocks, name。
    """
    return next(item for item in items_of(blocks) if item["name"] == name)


def test_a_time_feature_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲。"""
    operator, _ = registry.build("time_feature", {})
    assert operator.report() == ()


def test_the_hours_are_counted_in_the_business_time_zone() -> None:
    """UTC 零点那一行在东八区是 8 点：分布里落在 8 那一格，不是 0 那一格。

    ⚠ 两档口径造出来的列长得一模一样，只有这一格的位置分得出来。
    """
    frame = frame_at([moment_at(2026, 1, 1)])
    east = blocks_of(frame, tz=480)
    assert item_of(east, "小时·8 时")["value"] == 1
    assert item_of(east, "小时·0 时")["value"] == 0
    utc = blocks_of(frame, tz=0)
    assert item_of(utc, "小时·0 时")["value"] == 1
    assert item_of(utc, "小时·8 时")["value"] == 0


def test_every_bucket_shows_up_even_the_ones_nobody_landed_in() -> None:
    """逐格都摆出来：「凌晨没有数据」与「凌晨这一格没画」是两回事。"""
    blocks = blocks_of(
        frame_at([moment_at(2026, 3, 2, hour) for hour in (9, 10, 11)]),
        parts=ALL_PARTS,
    )
    assert len(items_of(blocks)) == ALL_BUCKETS
    assert item_of(blocks, "小时·3 时")["value"] == 0
    assert item_of(blocks, "小时·17 时")["value"] == 1
    assert item_of(blocks, "星期·周一")["value"] == 3
    assert item_of(blocks, "星期·周日")["value"] == 0


def test_the_year_day_is_folded_into_local_months() -> None:
    """年内第几天折成 12 格，且折的是**本地**月份。

    UTC 的 12 月 31 日 23 点在东八区已经是次年 1 月 1 日——折错时区的话这一行
    会落在 12 月那一格。
    """
    blocks = blocks_of(
        frame_at([moment_at(2026, 12, 31, 23)]),
        parts=["dayofyear"],
    )
    assert len(items_of(blocks)) == 12
    assert item_of(blocks, "年内第几天·1 月")["value"] == 1
    assert item_of(blocks, "年内第几天·12 月")["value"] == 0


def test_the_weekend_share_is_a_ratio_not_a_mean() -> None:
    """周末占比按整帧算：4 行里 1 行是周末就是 0.25。"""
    blocks = blocks_of(
        frame_at(
            [
                moment_at(2026, 3, 2, 12),
                moment_at(2026, 3, 3, 12),
                moment_at(2026, 3, 4, 12),
                moment_at(2026, 3, 7, 12),
            ]
        ),
        parts=["is_weekend"],
    )
    assert item_of(blocks, "是否周末·周末")["value"] == 1
    assert item_of(blocks, "是否周末·周末")["ratio"] == 0.25
    assert item_of(blocks, "是否周末·工作日")["value"] == 3


def test_the_axis_block_states_the_offset_and_the_real_span() -> None:
    """时区口径那一块：偏移量、实际起止（UTC RFC3339）、以及一条告警。"""
    blocks = blocks_of(
        frame_at([moment_at(2026, 1, 1), moment_at(2026, 1, 2, 5)])
    )
    payload = blocks["axis"].payload
    assert payload["tz_offset_minutes"] == 480
    assert payload["actual_since"] == "2026-01-01T00:00:00+00:00"
    assert payload["actual_until"] == "2026-01-02T05:00:00+00:00"
    assert payload["alerts"] == [TZ_ALERT.format(zone="UTC+08:00")]


def test_a_negative_offset_prints_with_its_minutes() -> None:
    """半小时时区照样印得出来：−330 分钟是 UTC-05:30，不是 −5.5。"""
    blocks = blocks_of(frame_at([moment_at(2026, 1, 1)]), tz=-330)
    assert blocks["columns"].payload["reason"] == (
        "按业务时区 UTC-05:30 从每一行的时刻造了 1 列"
    )
    assert blocks["axis"].payload["alerts"] == [
        TZ_ALERT.format(zone="UTC-05:30")
    ]


def test_the_columns_block_names_what_was_made() -> None:
    """造出来的列名与输出帧上真正多出来的那几列一致。"""
    operator, _ = registry.build(
        "time_feature", {"parts": ["hour", "is_weekend"]}
    )
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    produced = operator.run({"frame": frame_at([moment_at(2026, 1, 1)])})
    frame = produced["frame"]
    assert isinstance(frame, Frame)
    payload = {block.kind: block for block in operator.report()}[
        "columns"
    ].payload
    assert payload["added"] == ["ts_hour", "ts_is_weekend"]
    assert list(frame.keys) == ["温度", "ts_hour", "ts_is_weekend"]
    assert payload["kept"] == 3


def test_the_worst_time_load_still_fits_the_report_budget() -> None:
    """366 天逐时 × 五档全开：讲解装得下，一块都不用降档丢掉。"""
    start = moment_at(2026, 1, 1)
    operator, _ = registry.build("time_feature", {"parts": ALL_PARTS})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run(
        {
            "frame": frame_at(
                [start + hour * HOUR_MS for hour in range(YEAR_ROWS)]
            )
        }
    )
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES
    assert len(report["blocks"]) == 3
