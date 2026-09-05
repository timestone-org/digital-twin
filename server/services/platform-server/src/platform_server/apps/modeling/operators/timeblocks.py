"""时间特征那一步的结果面算料：新增列、时区口径、各档取值分布。

⚠ 造列与讲解共用同一份档位名与时区折算：两处各写一份的话，界面上的分组名与
真正造出来的列名会静默漂开（docs/MODELING_RESULT_VIEW_DESIGN.md §5-13）。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from platform_server.apps.modeling.operators.frame import Frame, numbers_of
from platform_server.apps.modeling.operators.reporting import (
    NOTE_ALERT,
    TIER_SCALAR,
    TIER_SMALL,
    BlockAt,
    ColumnChange,
    Item,
    ReportBlock,
    Scale,
    TimeAxis,
    annotated,
    axis_block,
    breakdown_block,
    columns_block,
)
from platform_server.apps.modeling.operators.steps import moment_text, ratio_of

# 时间特征只有一路输出，讲解全挂在它上面
PORT = "frame"
# 每一档给人看的名字。造列时的列名与讲解里的分组名共用这一份
PART_LABELS: Mapping[str, str] = {
    "hour": "小时",
    "dayofweek": "星期",
    "month": "月份",
    "dayofyear": "年内第几天",
    "is_weekend": "是否周末",
}
# 年内第几天有 366 个取值，摆不进按项的那一组数，折成本地月份
PART_DAYOFYEAR = "dayofyear"
_WEEKDAYS = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")
# 每一档的取值全集。⚠ 逐格都摆出来，包括一行都没有的那一格：「凌晨没有数据」
# 与「凌晨这一格没画」在图上是两回事
_DOMAINS: Mapping[str, tuple[int, ...]] = {
    "hour": tuple(range(24)),
    "dayofweek": tuple(range(7)),
    "month": tuple(range(1, 13)),
    PART_DAYOFYEAR: tuple(range(1, 13)),
    "is_weekend": (0, 1),
}

# 时区错了每个数看着都正常，只是整体偏了几个小时
TZ_ALERT = (
    "小时 / 星期 / 月份都按业务时区 {zone} 算，不按 UTC："
    "口径差一个时区，这几列整体偏几个小时，而每个数看着都在正常范围里"
)


@dataclass(frozen=True)
class TimeRun:
    """时间特征这一步实际做了什么，`time_blocks` 照它讲。"""

    #: 造出来的列，与 `parts` 同序
    made: tuple[str, ...]
    parts: tuple[str, ...]
    #: 造完那一份，逐档的取值从这里数
    result: Frame
    #: 每一行落在本地的哪个月；年内第几天那一档折成 12 格用它
    months: tuple[int, ...]
    tz_offset_minutes: int
    #: 实际覆盖的时刻区间（UTC 毫秒）；一行都没有时给 `None`
    span: tuple[int, int] | None


def time_blocks(run: TimeRun) -> tuple[ReportBlock, ...]:
    """时间特征的三块：新增列、时区口径、各档取值分布。

    Args: run。
    """
    return (_time_columns(run), _time_axis(run), _time_breakdown(run))


def _time_columns(run: TimeRun) -> ReportBlock:
    """造了哪几列。

    Args: run。
    """
    return columns_block(
        BlockAt(zone="step", title="新增列", port=PORT, tier=TIER_SMALL),
        ColumnChange(
            added=list(run.made),
            kept=len(run.result.columns),
            reason=(
                f"按业务时区 {tz_text(run.tz_offset_minutes)} "
                f"从每一行的时刻造了 {len(run.made)} 列"
            ),
        ),
    )


def _time_axis(run: TimeRun) -> ReportBlock:
    """时刻怎么折成本地时间：偏移量与实际覆盖的区间。

    Args: run。
    """
    span = run.span
    block = axis_block(
        BlockAt(zone="step", title="时区口径", port=PORT, tier=TIER_SCALAR),
        TimeAxis(
            tz_offset_minutes=run.tz_offset_minutes,
            actual_since=None if span is None else moment_text(span[0]),
            actual_until=None if span is None else moment_text(span[1]),
        ),
    )
    return _alerted(
        block, (TZ_ALERT.format(zone=tz_text(run.tz_offset_minutes)),)
    )


def _time_breakdown(run: TimeRun) -> ReportBlock:
    """每一档逐格有多少行。

    ⚠ 低基数循环量不给 min/p50/mean/max：「平均小时 11.5」说明不了任何事。
    Args: run。
    """
    items: list[Item] = []
    for part, key in zip(run.parts, run.made, strict=True):
        items.extend(_part_items(run, part, key))
    return breakdown_block(
        BlockAt(
            zone="charts",
            title="各档取值分布",
            port=PORT,
            tier=TIER_SMALL,
            is_primary=True,
        ),
        Scale(label="行数", unit="行"),
        items,
    )


def _part_items(run: TimeRun, part: str, key: str) -> list[Item]:
    """一档时间成分逐格的行数。

    ⚠ 年内第几天折成本地月份，不折成 366 项：那一档单独就顶穿按项的上限，
    而折下来的这 12 个数与月份那一档同源，不是估的。
    Args: run, part, key。
    """
    counted = _counted(
        run.months if part == PART_DAYOFYEAR else _integers(run.result, key)
    )
    label = PART_LABELS.get(part, part)
    return [
        {
            "name": f"{label}·{_bucket_text(part, bucket)}",
            "value": counted.get(bucket, 0),
            "spread": None,
            "part": part,
            "bucket": bucket,
            "ratio": ratio_of(counted.get(bucket, 0), run.result.row_count),
        }
        for bucket in _DOMAINS.get(part, ())
    ]


def tz_text(minutes: int) -> str:
    """时区偏移印成 `UTC+08:00` 这样的一行。

    Args: minutes。
    """
    sign = "-" if minutes < 0 else "+"
    span = abs(minutes)
    return f"UTC{sign}{span // 60:02d}:{span % 60:02d}"


def _integers(frame: Frame, key: str) -> list[int]:
    """一列上的整数取值，空的那几格不算。

    Args: frame, key。
    """
    return [int(value) for value in numbers_of(frame, key) if value is not None]


def _counted(values: Sequence[int]) -> dict[int, int]:
    """一串整数逐格各有多少个。

    Args: values。
    """
    tally: dict[int, int] = {}
    for value in values:
        tally[value] = tally.get(value, 0) + 1
    return tally


def _bucket_text(part: str, bucket: int) -> str:
    """一格给人看的名字。

    Args: part, bucket。
    """
    if part == "hour":
        return f"{bucket} 时"
    if part == "dayofweek":
        return _WEEKDAYS[bucket % len(_WEEKDAYS)]
    if part == "is_weekend":
        return "周末" if bucket == 1 else "工作日"
    return f"{bucket} 月"


def _alerted(block: ReportBlock, alerts: Sequence[str]) -> ReportBlock:
    """给一块挂上必须整条摆出来的告警。

    ⚠ 这一档说的是会让人**读出错误结论**的事，收进小问号里等于没说
    （规格 §11 的 R-24）。
    Args: block, alerts。
    """
    return annotated(block, NOTE_ALERT, alerts)
