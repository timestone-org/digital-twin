"""折外预测 → 评估指标：总体一份、每个服务组合各一份。

⚠ 全部指标只吃折外预测——「模型看过答案再打分」的训练内指标一个都不出。
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

# 组合在指标键与页面上的写法：serial 升序加号相连
SET_KEY_SEPARATOR = "+"


@dataclass(frozen=True)
class OofPrediction:
    """一条事件的折外预测与实际值。"""

    started_at: datetime
    running_set: tuple[str, ...]
    actual_minutes: int
    p10: float
    p50: float
    p90: float
    fold: int


@dataclass(frozen=True)
class ErrorStats:
    """一组折外预测的误差统计。`coverage` 标称 80%，显著更低说明区间在撒谎。"""

    count: int
    mae: float
    medae: float
    rmse: float
    coverage: float
    mean_width: float
    # 折外 p50 对实际的决定系数；实际值没有离散度时无定义
    r2: float | None


@dataclass(frozen=True)
class MetricsBlock:
    """一组折外预测的指标：整体统计 + 热行（实际>0）单独一份。

    ⚠ 实测近半开机「一开机就已达标」，整体 MAE 被大量误差为零的行灌水，
    只看它会把一个热行很差的模型读成「还行」。热行统计才是「要等多久」
    这个问题上的真实成绩单；`hot` 为 None = 这组里没有热行。
    """

    count: int
    mae: float
    medae: float
    rmse: float
    coverage: float
    mean_width: float
    r2: float | None
    hot: ErrorStats | None
    zero_count: int
    # 零行里被判成 0 的占比；None = 没有零行
    zero_hit_rate: float | None
    # 热行里被判出非零的占比（漏报的补）；None = 没有热行
    hot_hit_rate: float | None


@dataclass(frozen=True)
class ModelMetrics:
    """总体 + 按服务组合的评估。"""

    overall: MetricsBlock
    by_set: Mapping[str, MetricsBlock | None]


def set_key(running_set: Sequence[str]) -> str:
    """组合的稳定字面量键。

    Args: running_set。
    """
    return SET_KEY_SEPARATOR.join(sorted(running_set))


def summarize(
    oof: Sequence[OofPrediction],
    serving_sets: Sequence[Sequence[str]],
) -> ModelMetrics:
    """汇总总体与每个服务组合的指标；没有样本的组合给 None 而不是零。

    ⚠ None 与「指标为 0」是两回事：0 会被读成「误差为零的完美模型」。
    Args: oof, serving_sets。
    """
    grouped: dict[str, list[OofPrediction]] = {
        set_key(serving): [] for serving in serving_sets
    }
    for row in oof:
        found = grouped.get(set_key(row.running_set))
        if found is not None:
            found.append(row)
    return ModelMetrics(
        overall=_block(oof),
        by_set={
            key: _block(rows) if rows else None for key, rows in grouped.items()
        },
    )


def _stats(rows: Sequence[OofPrediction]) -> ErrorStats:
    """一组折外预测的误差统计。

    Args: rows（非空）。
    """
    errors = sorted(abs(row.p50 - row.actual_minutes) for row in rows)
    inside = sum(1 for row in rows if row.p10 <= row.actual_minutes <= row.p90)
    return ErrorStats(
        count=len(rows),
        mae=sum(errors) / len(errors),
        medae=_median(errors),
        rmse=math.sqrt(sum(error**2 for error in errors) / len(errors)),
        coverage=inside / len(rows),
        mean_width=sum(row.p90 - row.p10 for row in rows) / len(rows),
        r2=_r_squared(rows),
    )


def _r_squared(rows: Sequence[OofPrediction]) -> float | None:
    """折外 p50 对实际的决定系数；实际值全都一样时无定义。

    ⚠ 无定义给 None 不给 0 或 1：0 的含义是「与照搬均值一样好」、1 是「完美」，
    两个数都会被当成一份真实成绩读。单样本必然落进这一支。
    Args: rows（非空）。
    """
    mean_actual = sum(row.actual_minutes for row in rows) / len(rows)
    total = sum((row.actual_minutes - mean_actual) ** 2 for row in rows)
    if total == 0:
        return None
    residual = sum((row.p50 - row.actual_minutes) ** 2 for row in rows)
    return 1 - residual / total


def _block(rows: Sequence[OofPrediction]) -> MetricsBlock:
    """一组折外预测的指标块：整体 + 热行拆开。

    Args: rows（非空）。
    """
    whole = _stats(rows)
    hot_rows = [row for row in rows if row.actual_minutes > 0]
    zero_rows = [row for row in rows if row.actual_minutes == 0]
    return MetricsBlock(
        count=whole.count,
        mae=whole.mae,
        medae=whole.medae,
        rmse=whole.rmse,
        coverage=whole.coverage,
        mean_width=whole.mean_width,
        r2=whole.r2,
        hot=_stats(hot_rows) if hot_rows else None,
        zero_count=len(zero_rows),
        zero_hit_rate=(
            sum(1 for row in zero_rows if row.p50 == 0) / len(zero_rows)
            if zero_rows
            else None
        ),
        hot_hit_rate=(
            sum(1 for row in hot_rows if row.p50 > 0) / len(hot_rows)
            if hot_rows
            else None
        ),
    )


def _median(ordered: Sequence[float]) -> float:
    """已升序序列的中位数。

    Args: ordered。
    """
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2
