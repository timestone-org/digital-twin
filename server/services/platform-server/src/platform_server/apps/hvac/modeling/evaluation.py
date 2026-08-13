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
class MetricsBlock:
    """一组折外预测的指标。

    `coverage` 的标称值是 80%，显著更低说明区间在撒谎。
    """

    count: int
    mae: float
    medae: float
    rmse: float
    coverage: float
    mean_width: float


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


def _block(rows: Sequence[OofPrediction]) -> MetricsBlock:
    """一组折外预测的指标块。

    Args: rows（非空）。
    """
    errors = sorted(abs(row.p50 - row.actual_minutes) for row in rows)
    inside = sum(1 for row in rows if row.p10 <= row.actual_minutes <= row.p90)
    return MetricsBlock(
        count=len(rows),
        mae=sum(errors) / len(errors),
        medae=_median(errors),
        rmse=math.sqrt(sum(error**2 for error in errors) / len(errors)),
        coverage=inside / len(rows),
        mean_width=sum(row.p90 - row.p10 for row in rows) / len(rows),
    )


def _median(ordered: Sequence[float]) -> float:
    """已升序序列的中位数。

    Args: ordered。
    """
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2
