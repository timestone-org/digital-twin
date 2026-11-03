"""分类宏平均和真实样本数加权平均，未定义项不伪造为零。"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

AverageMode = Literal["macro", "weighted"]
METRIC_KEYS = ("precision", "recall", "f1")


@dataclass
class _Counts:
    actual: int = 0
    predicted: int = 0
    true_positive: int = 0


@dataclass(frozen=True)
class _Scores:
    values: tuple[float | None, float | None, float | None]
    support: int


def classification_averages(
    truth: Sequence[float], predicted: Sequence[float], mode: AverageMode
) -> dict[str, float | None]:
    """计算主显示口径及两套明确命名的汇总；Args: truth, predicted, mode。"""
    counts = _counts_of(truth, predicted)
    scores = [
        _Scores(
            values=(
                _ratio(item.true_positive, item.predicted),
                _ratio(item.true_positive, item.actual),
                _ratio(2 * item.true_positive, item.actual + item.predicted),
            ),
            support=item.actual,
        )
        for item in counts.values()
    ]
    summaries = {
        f"{key}_{average}": _mean(scores, index, average)
        for average in ("macro", "weighted")
        for index, key in enumerate(METRIC_KEYS)
    }
    return {
        "accuracy": _ratio(
            sum(item.true_positive for item in counts.values()), len(truth)
        ),
        **{key: summaries[f"{key}_{mode}"] for key in METRIC_KEYS},
        **summaries,
    }


def _counts_of(
    truth: Sequence[float], predicted: Sequence[float]
) -> dict[float, _Counts]:
    counts = {label: _Counts() for label in sorted({*truth, *predicted})}
    for actual, guess in zip(truth, predicted, strict=True):
        counts[actual].actual += 1
        counts[guess].predicted += 1
        if actual == guess:
            counts[actual].true_positive += 1
    return counts


def _mean(scores: Sequence[_Scores], index: int, mode: str) -> float | None:
    terms = [
        (item.values[index], 1 if mode == "macro" else item.support)
        for item in scores
        if item.values[index] is not None
    ]
    denominator = sum(weight for _, weight in terms)
    if denominator == 0:
        return None
    return (
        sum(value * weight for value, weight in terms if value is not None)
        / denominator
    )


def _ratio(numerator: int, denominator: int) -> float | None:
    return None if denominator == 0 else numerator / denominator
