"""二分类概率侧的算料：阈值网格，以及 ROC / PR / 校准三条曲线上的点。

⚠ 曲线由**后端**算：前端手上只有截断过的散点，拿它现算出来的曲线与同一屏的
指标卡对不上账，同屏两个数打架比没有这张图更坏
（docs/MODELING_RESULT_VIEW_DESIGN.md §13.3）。
⚠ 分母为 0 的量一律给 `None` 不给 0：AUC=0 读起来是「比瞎猜还差」，而实际是
「测试集里缺了一整类，这个数没有定义」。
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from platform_server.apps.modeling.operators.evalstats import even_sample
from platform_server.apps.modeling.operators.reporting import MAX_ITEMS

# 阈值网格取多少档。⚠ 规格 §13.3 写的是 ≤200，而 `breakdown` 的 `items` 在
# `reporting.py` 那一侧按 MAX_ITEMS 截断；ROC 还要在网格前面多摆一个「全判负类」
# 的锚点，故取 MAX_ITEMS − 1，多算的那一截才不会被无声截掉
GRID_POINTS = MAX_ITEMS - 1
# 校准曲线切几个等宽箱
CALIBRATION_BINS = 10
# 箱里不足这么多行就画空心：十来行上的实际正类率抖得读不出校准
SPARSE_BIN_ROWS = 10
# 多于这个类目数就没有「正类概率」这回事
BINARY_CLASSES = 2
# 多分类为什么没有那四样。⚠ 与下面那句分开写：四种「没有」不许合并成一句
# （规格 §2-P5），两者要用户做的事不同——这一句要用户改建模口径
MULTICLASS_NOTE = (
    "多分类不产概率列，ROC / PR / 校准曲线与阈值网格都要二分类。"
    "下面四个指标是单一阈值上的一张切片"
)
# 没有概率列为什么没有那四样。这一句要用户换上游算子或重跑
NO_PROBABILITY_NOTE = (
    "这份打分结果里没有可用的每行概率（y_proba 列缺失或有空值），"
    "ROC / PR / 校准曲线与阈值网格都画不出来。"
    "下面四个指标是单一阈值上的一张切片"
)
# 缺了一整类时那两个数为什么是空的
ONE_SIDED_NOTE = (
    "测试集里只有一类（或正类一次都没出现），AUC 与 AP 都无定义，"
    "ROC 与 PR 曲线也画不出来"
)
# 两个总量各自怎么算出来的
PROBABILITY_NOTE = (
    "AUC = 全部不同概率值上按梯形法算的 ROC 下面积，0.5 等于瞎猜；"
    "AP = Σ（召回增量 × 该点精确率）"
)
ROC_NOTE = "横轴假正率、纵轴真正率；对角线是随机基准"
PR_NOTE = "横轴召回率、纵轴精确率；基线是正类占比，类不平衡时它比 ROC 诚实"
CALIBRATION_NOTE = (
    "横轴平均预测概率、纵轴实际正类率；对角线是完美校准，"
    "箱里不足十行的点画空心，别照它下结论"
)
GRID_NOTE = (
    "每个阈值上的 TP / FP / TN / FN 与 F1；"
    "竖线是打分时判成正类的最低概率，也就是这一份指标卡站的那个阈值"
)
_ZERO = 0.0


@dataclass(frozen=True)
class ThresholdCount:
    """一个阈值上判对判错的四格。四格之和恒等于测试行数。"""

    threshold: float
    true_positive: int
    false_positive: int
    true_negative: int
    false_negative: int


@dataclass(frozen=True)
class Curves:
    """一份二分类打分结果的概率侧：阈值网格与它上面的三个总量。

    ⚠ `auc` 与 `average_precision` 在**全部**不同的概率值上算，`grid` 只是同一
    条曲线上抽出来画的那几十档：数与图同源，同一屏上两处才不会打架。
    """

    grid: tuple[ThresholdCount, ...]
    positives: int
    negatives: int
    auc: float | None
    average_precision: float | None
    positive_rate: float | None


def threshold_counts(
    probabilities: Sequence[float], actual_positive: Sequence[bool]
) -> tuple[ThresholdCount, ...]:
    """每一个不同的概率值当阈值时的四格计数，按阈值从高到低。

    ⚠ 判据是 `>=`，与建模算子把概率折成硬标签的那一处同向：反向的话同一个阈值
    在两处数出的正类数不同，而这两个数会并排摆在同一屏上。
    Args: probabilities, actual_positive。
    """
    ranked = sorted(
        zip(probabilities, actual_positive, strict=True),
        key=lambda pair: -pair[0],
    )
    positives = sum(1 for flag in actual_positive if flag)
    negatives = len(ranked) - positives
    made: list[ThresholdCount] = []
    seat = 0
    hit = 0
    miss = 0
    for threshold in sorted(set(probabilities), reverse=True):
        while seat < len(ranked) and ranked[seat][0] >= threshold:
            if ranked[seat][1]:
                hit += 1
            else:
                miss += 1
            seat += 1
        made.append(
            ThresholdCount(
                threshold, hit, miss, negatives - miss, positives - hit
            )
        )
    return tuple(made)


def curves_of(
    probabilities: Sequence[float],
    actual_positive: Sequence[bool],
    limit: int = GRID_POINTS,
) -> Curves:
    """阈值网格、AUC、AP 与正类占比。

    ⚠ 只有一类时 AUC 与 AP 双双给 `None`：全是正类时 AP 在数学上等于 1，而那是
    「没有负类可分辨」不是「分得完美」，印出来必被读成后者。
    Args: probabilities, actual_positive, limit。
    """
    full = threshold_counts(probabilities, actual_positive)
    positives = sum(1 for flag in actual_positive if flag)
    negatives = len(actual_positive) - positives
    both = positives > 0 and negatives > 0
    return Curves(
        grid=even_sample(full, limit),
        positives=positives,
        negatives=negatives,
        auc=_auc_of(full, positives, negatives) if both else None,
        average_precision=(
            _average_precision(full, positives) if both else None
        ),
        positive_rate=(
            None if not actual_positive else positives / len(actual_positive)
        ),
    )


def roc_items(curves: Curves) -> list[dict[str, Any]]:
    """ROC 曲线上的点：(假正率, 真正率)。第一个点是「全判负类」那一头。

    ⚠ 缺了一整类就一个点都不给：假正率或真正率的分母是 0，硬画会得到一条从原点
    直冲到 (1,1) 的假对角线，读起来像「这个模型正好等于瞎猜」。
    Args: curves。
    """
    if curves.positives == 0 or curves.negatives == 0:
        return []
    made: list[dict[str, Any]] = [
        {
            "name": "全判负类",
            "threshold": None,
            "fpr": _ZERO,
            "tpr": _ZERO,
            "value": _ZERO,
        }
    ]
    for count in curves.grid:
        rate = count.true_positive / curves.positives
        made.append(
            {
                "name": threshold_text(count.threshold),
                "threshold": count.threshold,
                "fpr": count.false_positive / curves.negatives,
                "tpr": rate,
                "value": rate,
            }
        )
    return made


def pr_items(curves: Curves) -> list[dict[str, Any]]:
    """PR 曲线上的点：(召回率, 精确率)，左端是召回最小的那一头。

    ⚠ 一行都没判成正类时精确率无定义，那个点给 `None` 不给 0——0 会被读成
    「判成正类的全错了」。
    ⚠ 一个负类都没有时整条不给：那时假正数恒为 0、精确率恒为 1，画出来是一条
    贴着顶边的直线，读起来像「这个模型一个都没判错」。
    Args: curves。
    """
    if curves.positives == 0 or curves.negatives == 0:
        return []
    made: list[dict[str, Any]] = []
    for count in curves.grid:
        guessed = count.true_positive + count.false_positive
        precision = None if guessed == 0 else count.true_positive / guessed
        made.append(
            {
                "name": threshold_text(count.threshold),
                "threshold": count.threshold,
                "recall": count.true_positive / curves.positives,
                "precision": precision,
                "value": precision,
            }
        )
    return made


def grid_items(curves: Curves) -> list[dict[str, Any]]:
    """阈值网格：每个阈值上的四格计数与 F1。

    ⚠ 前端拖动阈值时查这张表、不拿截断过的散点重算：重算出来的曲线与同屏的
    指标卡对不上账，比没有这张图更坏（规格 §13.3）。
    Args: curves。
    """
    return [
        {
            "name": threshold_text(count.threshold),
            "threshold": count.threshold,
            "tp": count.true_positive,
            "fp": count.false_positive,
            "tn": count.true_negative,
            "fn": count.false_negative,
            "value": _f1_of(count),
        }
        for count in curves.grid
    ]


def calibration_items(
    probabilities: Sequence[float],
    actual_positive: Sequence[bool],
    bins: int = CALIBRATION_BINS,
) -> list[dict[str, Any]]:
    """校准曲线：等宽箱里的平均预测概率对实际正类率，外加每箱行数。

    ⚠ 空箱不列：补一个 0 会在图上画出一段「预测得挺高却一个正类都没有」的假
    塌陷，而那一档实际上一行数据都没有。
    Args: probabilities, actual_positive, bins。
    """
    seats = max(1, min(bins, MAX_ITEMS))
    sums = [_ZERO] * seats
    hits = [0] * seats
    counts = [0] * seats
    for value, flag in zip(probabilities, actual_positive, strict=True):
        seat = min(seats - 1, max(0, int(value * seats)))
        sums[seat] += value
        hits[seat] += 1 if flag else 0
        counts[seat] += 1
    return _calibration_rows(seats, sums, hits, counts)


def threshold_text(value: float) -> str:
    """阈值在界面上的写法：三位小数。

    Args: value。
    """
    return f"{value:.3f}"


def _auc_of(
    grid: Sequence[ThresholdCount], positives: int, negatives: int
) -> float:
    """ROC 曲线下面积，梯形法，从 (0,0) 起算。

    Args: grid, positives, negatives。
    """
    area = _ZERO
    last_fpr = _ZERO
    last_tpr = _ZERO
    for count in grid:
        fpr = count.false_positive / negatives
        tpr = count.true_positive / positives
        area += (fpr - last_fpr) * (tpr + last_tpr) / 2
        last_fpr, last_tpr = fpr, tpr
    return area


def _average_precision(grid: Sequence[ThresholdCount], positives: int) -> float:
    """AP = Σ（召回增量 × 该点精确率）。

    ⚠ 不是 PR 曲线下的梯形面积：召回跳变处的梯形会把精确率插值成实际取不到的
    值，AP 一路偏高。
    Args: grid, positives。
    """
    area = _ZERO
    last_recall = _ZERO
    for count in grid:
        recall = count.true_positive / positives
        guessed = count.true_positive + count.false_positive
        if guessed > 0:
            area += (recall - last_recall) * (count.true_positive / guessed)
        last_recall = recall
    return area


def _f1_of(count: ThresholdCount) -> float | None:
    """一个阈值上的 F1；真正类与判成正类的都没有时无定义。

    Args: count。
    """
    guessed = count.false_positive + count.false_negative
    denominator = 2 * count.true_positive + guessed
    return None if denominator == 0 else 2 * count.true_positive / denominator


def _calibration_rows(
    seats: int,
    sums: Sequence[float],
    hits: Sequence[int],
    counts: Sequence[int],
) -> list[dict[str, Any]]:
    """每个非空箱的一行：预测均值、实际正类率、行数与够不够厚。

    Args: seats, sums, hits, counts。
    """
    return [
        {
            "name": f"{seat / seats:.1f}–{(seat + 1) / seats:.1f}",
            "value": hits[seat] / counts[seat],
            "predicted": sums[seat] / counts[seat],
            "actual": hits[seat] / counts[seat],
            "count": counts[seat],
            "is_sparse": counts[seat] < SPARSE_BIN_ROWS,
            "low": seat / seats,
            "high": (seat + 1) / seats,
        }
        for seat in range(seats)
        if counts[seat] > 0
    ]
