"""五个评估算子的块算料：分位、等距抽样、最差行、逐折布局，以及它们拼成的块。

⚠ 一律纯函数、零副作用：算料写进算子类里的话，两个贴着行数上限的算子文件下一次
谁都改不动（docs/MODELING_RESULT_VIEW_DESIGN.md §8.1）。
⚠ 上限取 `reporting.py` 那一份，不各写各的——多算出来的一截会在构造函数那里被
截掉，等于白算。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from statistics import NormalDist
from typing import Any

from platform_server.apps.modeling.operators.reporting import (
    MAX_ITEMS,
    MAX_SEGMENTS,
)
from platform_server.apps.modeling.operators.steps import moment_text

# 残差分位数取这几档；QQ 图与它共用同一套插值口径
QUANTILES: tuple[tuple[float, str], ...] = (
    (0.05, "5% 分位"),
    (0.25, "下四分位"),
    (0.5, "中位数"),
    (0.75, "上四分位"),
    (0.95, "95% 分位"),
)
# QQ 图上取多少个等距分位点
QQ_POINTS = 51
# 误差最大的多少行摆进明细
WORST_ROWS = 20
# 残差随时间那条线切成多少格。⚠ 按格取均值而不是抽样：抽样会把工况切换造成的整段
# 偏移抽没了，而那正是这条线要答的问题
DRIFT_BUCKETS = 60
# 少于这么多个数，既算不出离散度也画不出一条线
MIN_POINTS = 2
_ZERO = 0.0


@dataclass(frozen=True)
class Scored:
    """一次评估看到的那份打分结果，`report()` 照它讲。"""

    truth: tuple[float, ...]
    predicted: tuple[float, ...]
    residuals: tuple[float, ...]
    #: 打分帧的时刻；None = 上游没带时刻，残差随时间那条线画不出来
    index: tuple[int, ...] | None = None


def scored_of(
    truth: Sequence[float],
    predicted: Sequence[float],
    index: Sequence[int] | None = None,
) -> Scored:
    """把真实值、预测值与时刻收成一包，顺带算好残差。

    Args: truth, predicted, index。
    """
    return Scored(
        truth=tuple(truth),
        predicted=tuple(predicted),
        residuals=tuple(
            actual - guess
            for actual, guess in zip(truth, predicted, strict=True)
        ),
        index=None if index is None else tuple(index),
    )


@dataclass(frozen=True)
class MetricSpec:
    """一个指标在结果面上的写法。

    ⚠ `score_kind` 空串 = 没有公认的好坏线，界面一律灰（规格 §2-P3）。
    """

    key: str
    name: str
    unit: str = ""
    score_kind: str = ""


REGRESSION_METRICS: tuple[MetricSpec, ...] = (
    MetricSpec("r2", "R²", "", "r2"),
    MetricSpec("rmse", "RMSE"),
    MetricSpec("mae", "MAE"),
    MetricSpec("mape", "MAPE", "%", "mape"),
    MetricSpec("max_error", "最大误差"),
)

CLASSIFICATION_METRICS: tuple[MetricSpec, ...] = (
    MetricSpec("accuracy", "准确率", "", "accuracy"),
    MetricSpec("precision", "精确率", "", "precision"),
    MetricSpec("recall", "召回率", "", "recall"),
    MetricSpec("f1", "F1", "", "f1"),
)

RESIDUAL_METRICS: tuple[MetricSpec, ...] = (
    MetricSpec("residual_mean", "偏均值"),
    MetricSpec("residual_std", "离散度"),
    MetricSpec("residual_p05", "5% 分位"),
    MetricSpec("residual_p95", "95% 分位"),
    MetricSpec("residual_max_abs", "最大绝对误差"),
)


def metric_items(
    specs: Sequence[MetricSpec], values: Mapping[str, float | None]
) -> list[dict[str, Any]]:
    """一组指标摆成按项的数。

    ⚠ 键在名单里而值缺席时留 `None`：那是「这次没算」，与「算出来是 0」不是
    一回事。
    Args: specs, values。
    """
    return [
        {
            "name": spec.name,
            "key": spec.key,
            "value": values.get(spec.key),
            "unit": spec.unit,
            "score_kind": spec.score_kind,
        }
        for spec in specs[:MAX_ITEMS]
    ]


def quantile_at(ordered: Sequence[float], ratio: float) -> float:
    """有序序列上的线性插值分位数。

    ⚠ 分位数的插值口径各家不同，写死这一份并在公式里写出来，别处的数才对得上。
    Args: ordered, ratio。
    """
    position = ratio * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def quantile_items(residuals: Sequence[float]) -> list[dict[str, Any]]:
    """残差的五档分位数加一个最大绝对误差。

    Args: residuals。
    """
    if not residuals:
        return []
    ordered = sorted(residuals)
    items: list[dict[str, Any]] = [
        {"name": name, "value": quantile_at(ordered, ratio), "ratio": ratio}
        for ratio, name in QUANTILES
    ]
    biggest = max(abs(value) for value in ordered)
    items.append({"name": "最大绝对误差", "value": biggest, "ratio": None})
    return items


def even_sample[T](values: Sequence[T], limit: int) -> tuple[T, ...]:
    """等距抽这么多个；不足上限就原样交回。

    ⚠ 不是头切：时序数据上头切等于只看最早那一段，而散点图要答的是「整段测试集
    上准不准」（规格 §5-20）。
    Args: values, limit。
    """
    if limit <= 0 or not values:
        return ()
    if len(values) <= limit:
        return tuple(values)
    last = len(values) - 1
    step = last / max(limit - 1, 1)
    return tuple(values[round(seat * step)] for seat in range(limit))


def worst_items(
    scored: Scored, limit: int = WORST_ROWS
) -> list[dict[str, Any]]:
    """误差最大的那几行，连时刻与两侧原值一起。

    Args: scored, limit。
    """
    seats = sorted(
        range(len(scored.truth)),
        key=lambda seat: -abs(scored.residuals[seat]),
    )
    return [
        {
            "name": _row_name(seat, scored.index),
            "value": scored.residuals[seat],
            "truth": scored.truth[seat],
            "predicted": scored.predicted[seat],
            "row": seat,
        }
        for seat in seats[: min(limit, MAX_ITEMS)]
    ]


def qq_items(
    residuals: Sequence[float], count: int = QQ_POINTS
) -> list[dict[str, Any]]:
    """QQ 图：实测分位对同均值同方差的正态分位。

    ⚠ 方差为零时一个点都不给：那条线退化成一个点，画出来读者会以为残差正态。
    Args: residuals, count。
    """
    ordered = sorted(residuals)
    deviation = deviation_of(ordered)
    if len(ordered) < MIN_POINTS or deviation is None or deviation <= _ZERO:
        return []
    normal = NormalDist(sum(ordered) / len(ordered), deviation)
    seats = max(MIN_POINTS, min(count, MAX_ITEMS))
    return [
        {
            "name": f"{(seat + 0.5) / seats:.3f}",
            "value": quantile_at(ordered, (seat + 0.5) / seats),
            "expected": normal.inv_cdf((seat + 0.5) / seats),
            "ratio": (seat + 0.5) / seats,
        }
        for seat in range(seats)
    ]


def drift_items(
    scored: Scored, buckets: int = DRIFT_BUCKETS
) -> list[dict[str, Any]]:
    """残差随时间：轴切成等宽格，每格给一个均值。

    ⚠ 没有时刻就一格都不给：拿行序冒充时间轴的话，采集断档那一段会被画成连续的。
    Args: scored, buckets。
    """
    index = scored.index
    if index is None or len(index) < MIN_POINTS or index[-1] <= index[0]:
        return []
    seats = max(1, min(buckets, MAX_ITEMS))
    width = (index[-1] - index[0]) / seats
    sums = [0.0] * seats
    counts = [0] * seats
    for moment, value in zip(index, scored.residuals, strict=True):
        seat = min(seats - 1, int((moment - index[0]) / width))
        sums[seat] += value
        counts[seat] += 1
    return _drift_rows(index[0], width, sums, counts)


def fold_items(
    folds: Sequence[tuple[Sequence[int], Sequence[int]]],
) -> list[dict[str, Any]]:
    """每一折的训练段与测试段在行序上的位置。

    ⚠ 训练段给的是**包络**：等分 K 折的训练行分居测试段两侧，一段画不下，界面
    照这个包络画底条、测试段画在它上面。
    Args: folds。
    """
    return [
        {
            "name": f"第 {seat + 1} 折",
            "since": min(train),
            "until": max(train) + 1,
            "test_since": test[0],
            "test_until": test[-1] + 1,
            "train_rows": len(train),
            "test_rows": len(test),
        }
        for seat, (train, test) in enumerate(folds[:MAX_SEGMENTS])
    ]


def fold_score_items(scores: Sequence[float]) -> list[dict[str, Any]]:
    """逐折的分。

    ⚠ 只给均值与 σ 读不出是某一折特别差还是普遍抖，而那正是这条评估要说的事。
    Args: scores。
    """
    return [
        {"name": f"第 {seat + 1} 折", "value": value}
        for seat, value in enumerate(scores[:MAX_ITEMS])
    ]


def deviation_of(values: Sequence[float]) -> float | None:
    """总体标准差（除 n）；一个数都没有时给 `None`。

    Args: values。
    """
    if not values:
        return None
    mean = sum(values) / len(values)
    return (sum((value - mean) ** 2 for value in values) / len(values)) ** 0.5


def repeat_spread(values: Sequence[float]) -> float | None:
    """几遍重复实验之间的波动；只跑过一遍时给 `None`，不给 0。

    ⚠ 给 0 会被读成「这一列的重要性非常稳」，而实际是「只打乱了一遍，稳不稳
    不知道」。
    Args: values。
    """
    return None if len(values) < MIN_POINTS else deviation_of(values)


def residual_marks(mean: float, deviation: float) -> list[dict[str, Any]]:
    """残差直方上的参考线：零、偏均值、±1σ。

    ⚠ σ=0 时不画那两条：它们会与偏均值叠在同一处，读起来像一条粗线。
    Args: mean, deviation。
    """
    marks: list[dict[str, Any]] = [
        {"at": _ZERO, "label": "零误差", "intent": "warning"},
        {"at": mean, "label": "偏均值", "intent": "info"},
    ]
    if deviation > _ZERO:
        marks.append({"at": mean - deviation, "label": "−1σ", "intent": "info"})
        marks.append({"at": mean + deviation, "label": "+1σ", "intent": "info"})
    return marks


def _drift_rows(
    since: int, width: float, sums: Sequence[float], counts: Sequence[int]
) -> list[dict[str, Any]]:
    """每一格的均值与行数；一行都没落进来的格不列。

    Args: since, width, sums, counts。
    """
    return [
        {
            "name": moment_text(int(since + width * seat)),
            "value": sums[seat] / counts[seat],
            "count": counts[seat],
            "since": int(since + width * seat),
            "until": int(since + width * (seat + 1)),
        }
        for seat in range(len(counts))
        if counts[seat] > 0
    ]


def _row_name(seat: int, index: Sequence[int] | None) -> str:
    """一行在明细里怎么称呼：有时刻就用时刻，没有就用行序。

    Args: seat, index。
    """
    if index is None or seat >= len(index):
        return f"第 {seat + 1} 行"
    return moment_text(index[seat])
