"""块的算料：分箱、时间轴占用、按列归因、样例值、漏斗、逐列类型对照。

24 个算子共用这一份。⚠ 一律纯函数、零副作用：算料写进算子类里的话，几个贴着
行数上限的算子文件下一次谁都改不动（docs/MODELING_RESULT_VIEW_DESIGN.md §8.1）。
⚠ 上限取 `reporting.py` 那一份，不各写各的——多算出来的一截会在构造函数那里被
截掉，等于白算。
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import pairwise
from typing import Any

from platform_server.apps.modeling.operators.reporting import (
    MAX_BINS,
    MAX_DTYPE_BEFORE,
    MAX_GAPS,
    MAX_OCCUPANCY,
    MAX_ROW_COLUMNS,
    MAX_SAMPLES,
    ColumnBins,
    Item,
)

# 样例值最多带这么长。⚠ 台账的文本列里可能是备注、联系人这类，整段带出去会落进
# JSONB 并随详情接口发给每一个看得到这次运行的人
MAX_SAMPLE_TEXT = 24
# 比例与占用率各留这么多位小数：再多的位数在图上一个像素都换不来
RATIO_DIGITS = 6
OCCUPANCY_DIGITS = 3
# 相邻两行的间隔超过中位间隔这么多倍才算断档
GAP_FACTOR = 3


@dataclass(frozen=True)
class Stage:
    """漏斗的一级。⚠ `value=None` = 这一级的数拿不到，不是 0。"""

    name: str
    value: int | None
    unit: str = ""
    #: 拿不到时说清为什么拿不到——空着的话界面只能印一个「—」
    note: str = ""


@dataclass(frozen=True)
class Spread:
    """一列数的分布：等宽桶高、轴的两端、以及落不到这条轴上的那一撮。"""

    counts: list[float]
    low: float | None
    high: float | None
    off_count: int


@dataclass(frozen=True)
class AxisSpan:
    """时间轴上的账：等宽格的占用率、断档、以及中位采集间隔。"""

    occupancy: list[float]
    gaps: list[dict[str, Any]]
    #: 中位采集间隔；None = 不足两行、或每一行都挤在同一个时刻，算不出来
    step_ms: int | None


def funnel_of(stages: Sequence[Stage]) -> list[dict[str, Any]]:
    """逐级收窄的账，一级不落地折成明细。

    ⚠ 这里**不截**：截断归 `rows_block`，它同时把截断前的级数记进 payload。
    在这里先截的话那个数恒等于上限，界面据它说的「后面还有几级」是句假话。
    Args: stages。
    """
    return [
        {
            "name": stage.name,
            "value": stage.value,
            "unit": stage.unit,
            "note": stage.note,
        }
        for stage in stages
    ]


def spread_of(
    values: Sequence[float | None],
    *,
    buckets: int = MAX_BINS,
    low: float | None = None,
    high: float | None = None,
) -> Spread:
    """把一列数分进等宽的桶；空值不进桶，单独记成离轴的那一撮。

    ⚠ NaN 与 ±inf 一并当离轴：它们在数轴上没有位置，混进桶里会让整段跨度算不
    出来，整张图跟着不画。
    ⚠ 指定了轴的两端时，端外的值夹进最边上那个桶——把它们算进「离轴」会与空值
    混成同一个数，而两者要用户做的事完全不同。
    Args: values, buckets, low, high。
    """
    numbers = [
        value for value in values if value is not None and math.isfinite(value)
    ]
    off = len(values) - len(numbers)
    if not numbers:
        return Spread([], low, high, off)
    span_low = min(numbers) if low is None else low
    span_high = max(numbers) if high is None else high
    seats = 1 if span_high <= span_low else max(1, min(buckets, MAX_BINS))
    counts = [0.0] * seats
    width = (span_high - span_low) / seats
    for value in numbers:
        counts[_seat(value, span_low, width, seats)] += 1
    return Spread(counts, span_low, span_high, off)


def column_bins(
    key: str,
    spread: Spread,
    *,
    off_label: str = "空值",
    marks: Sequence[Item] = (),
    dropped: Sequence[float] = (),
) -> ColumnBins:
    """把一份分布折成 `bins` 块里的一列。

    Args: key, spread, off_label, marks, dropped（逐桶被丢掉的行数）。
    """
    return ColumnBins(
        key=key,
        bins=spread.counts,
        low=spread.low,
        high=spread.high,
        marks=marks,
        dropped=dropped,
        off_axis=(
            None
            if spread.off_count <= 0
            else {"label": off_label, "count": spread.off_count}
        ),
    )


def dropped_bins(before: Spread, after: Spread) -> list[float]:
    """同一条轴上「进来的」减「留下的」= 这一桶里被丢掉的行数。

    ⚠ 两份分布必须铺在同一条轴上、切一样多的桶（取数时把 `before` 的两端传给
    `after`），否则逐桶相减减的是两条不同的轴。
    ⚠ 减出负数一律夹回 0：那说明两条轴对不上，宁可不报也不许把「留下的」画成
    「丢掉的」。
    Args: before, after。
    """
    kept = after.counts
    return [
        max(count - (kept[seat] if seat < len(kept) else 0.0), 0.0)
        for seat, count in enumerate(before.counts)
    ]


def axis_span(
    index: Sequence[int],
    *,
    slots: int = MAX_OCCUPANCY,
    factor: int = GAP_FACTOR,
) -> AxisSpan:
    """时间索引折成占用率序列与断档清单。

    ⚠ 占用率按**中位采集间隔**折算「这一格本该有多少行」，不按最忙那一格归一：
    按最忙那一格归一的话，同一段数据换个时间范围画出来的高矮就不一样。
    Args: index, slots, factor。
    """
    moments = sorted(index)
    step = _median_step(moments)
    if step is None or moments[-1] <= moments[0]:
        return AxisSpan([], [], step)
    seats = _seats_of(moments, step, slots)
    return AxisSpan(
        _occupancy(moments, step, seats), _gaps(moments, step, factor), step
    )


def by_column(
    counts: Mapping[str, int],
    *,
    whole: int = 0,
    limit: int = MAX_ROW_COLUMNS,
) -> list[dict[str, Any]]:
    """按列的归因，多的排前面，截到上限。一个都没摊上的列不列。

    ⚠ 零的不列而不是列成 0：这一栏答的是「谁的锅」，把没份的列也摆上去只会把
    真正那一列挤出上限。
    Args: counts, whole, limit。
    """
    ranked = sorted(
        ((key, count) for key, count in counts.items() if count > 0),
        key=lambda pair: (-pair[1], pair[0]),
    )
    return [
        {"key": key, "count": count, "ratio": ratio_of(count, whole)}
        for key, count in ranked[: max(0, min(limit, MAX_ROW_COLUMNS))]
    ]


def samples_of(
    values: Sequence[object],
    *,
    limit: int = MAX_SAMPLES,
    width: int = MAX_SAMPLE_TEXT,
) -> list[float | str | None]:
    """给用户核对用的几个原值。

    ⚠ 只带前几个且逐个截短：台账的文本列里可能是备注、联系人这类，整段带出去
    会落进 JSONB 并随详情接口发给每一个看得到这次运行的人。
    Args: values, limit, width。
    """
    return [
        _sample(value, width)
        for value in values[: max(0, min(limit, MAX_SAMPLES))]
    ]


def dtype_changes(
    before: Mapping[str, str],
    after: Mapping[str, str],
    *,
    limit: int = MAX_DTYPE_BEFORE,
) -> list[dict[str, Any]]:
    """逐列的类型前后对照，只列真的换过的那几列。

    Args: before, after, limit。
    """
    changed = [
        {"key": key, "before": kind, "after": after[key]}
        for key, kind in before.items()
        if key in after and after[key] != kind
    ]
    return changed[: max(0, min(limit, MAX_DTYPE_BEFORE))]


def ratio_of(part: int, whole: int) -> float | None:
    """占比。⚠ 分母为零给 `None` 不给 0：那是「算不出来」，不是「零」。

    Args: part, whole。
    """
    return None if whole <= 0 else round(part / whole, RATIO_DIGITS)


def moment_text(moment_ms: int) -> str:
    """一个毫秒时刻印成 UTC 的 RFC3339 文本。

    Args: moment_ms。
    """
    return datetime.fromtimestamp(moment_ms / 1000, UTC).isoformat()


def _seats_of(moments: Sequence[int], step: int, slots: int) -> int:
    """占用率切几格。

    ⚠ 格子不许比中位采集间隔还窄：窄了之后「这一格本该有多少行」恒为 1，占用率
    退化成「行数 ÷ 格数」——48 行铺在 200 格上会印出「平均占用率 24%」，而那一段
    其实一个断档都没有。故格数还要按跨度 ÷ 间隔封一道顶。
    Args: moments, step, slots。
    """
    reach = int((moments[-1] - moments[0]) / step)
    return max(1, min(slots, MAX_OCCUPANCY, reach))


def _seat(value: float, low: float, width: float, seats: int) -> int:
    """一个值落在第几个桶；端外的夹进最边上那个。

    Args: value, low, width, seats。
    """
    if width <= 0:
        return 0
    return min(seats - 1, max(0, int((value - low) / width)))


def _sample(value: object, width: int) -> float | str | None:
    """一个原值截成能安全带出去的样子。

    Args: value, width。
    """
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value)
    return text if len(text) <= width else f"{text[:width]}…"


def _median_step(moments: Sequence[int]) -> int | None:
    """相邻两行的中位间隔；不足两行或全挤在同一时刻的给 `None`。

    Args: moments。
    """
    steps = sorted(
        later - earlier
        for earlier, later in pairwise(moments)
        if later > earlier
    )
    return steps[len(steps) // 2] if steps else None


def _occupancy(moments: Sequence[int], step: int, seats: int) -> list[float]:
    """每一格的行数 ÷ 这一格按中位间隔本该有的行数，夹在 [0,1]。

    Args: moments, step, seats。
    """
    width = (moments[-1] - moments[0]) / seats
    counts = [0] * seats
    for moment in moments:
        counts[min(seats - 1, int((moment - moments[0]) / width))] += 1
    due = max(width / step, 1.0)
    return [round(min(count / due, 1.0), OCCUPANCY_DIGITS) for count in counts]


def _gaps(
    moments: Sequence[int], step: int, factor: int
) -> list[dict[str, Any]]:
    """断档：相邻两行隔得超过中位间隔的若干倍。最长的排前面，截到上限。

    Args: moments, step, factor。
    """
    found = [
        {
            "since": earlier,
            "until": later,
            "missing": max(round((later - earlier) / step) - 1, 0),
        }
        for earlier, later in pairwise(moments)
        if later - earlier > step * factor
    ]
    found.sort(key=_width_of, reverse=True)
    return found[:MAX_GAPS]


def _width_of(gap: Mapping[str, Any]) -> int:
    """一个断档有多长，排序用。

    Args: gap。
    """
    return int(gap["until"]) - int(gap["since"])
