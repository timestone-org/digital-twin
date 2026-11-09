"""成批预测必须与逐行预测逐位相同：成批只是省掉逐棵树的 Python 调用。"""

import numpy as np

from platform_server.apps.hvac.modeling.artifact import (
    StagePair,
    predict_mixture,
    predict_mixture_many,
)
from platform_server.apps.hvac.modeling.estimators import (
    DurationForest,
    ZeroClassifier,
)

ROWS = [
    [float(index % 7), float(index % 3), float("nan") if index % 5 else 1.0]
    for index in range(40)
]
PROBES = [[0.0, 1.0, 1.0], [3.0, 2.0, float("nan")], [6.0, 0.0, 1.0]]


def _pair() -> StagePair:
    """一套在合成数据上拟合好的两段模型。"""
    classifier = ZeroClassifier()
    classifier.fit(
        ROWS,
        [index % 4 == 0 for index in range(len(ROWS))],
        sample_weight=[1.0] * len(ROWS),
    )
    forest = DurationForest()
    forest.fit(
        ROWS,
        [5.0 + 3.0 * (index % 7) for index in range(len(ROWS))],
        sample_weight=[1.0] * len(ROWS),
    )
    return StagePair(zero_classifier=classifier, duration_forest=forest)


def test_batched_quantiles_equal_row_by_row() -> None:
    forest = _pair().duration_forest
    assert forest is not None
    levels = [[0.1, 0.5, 0.9], [0.5], [0.2, 0.8]]
    batched = forest.quantiles_many(PROBES, levels)
    single = [
        forest.quantiles_at(row, level)
        for row, level in zip(PROBES, levels, strict=True)
    ]
    np.testing.assert_array_equal(
        np.concatenate(batched), np.concatenate(single)
    )


def test_batched_zero_probability_equals_row_by_row() -> None:
    classifier = _pair().zero_classifier
    batched = classifier.proba_zero_many(PROBES)
    single = [classifier.proba_zero(row) for row in PROBES]
    np.testing.assert_array_equal(batched, single)


def test_batched_mixture_equals_row_by_row() -> None:
    """已知达标与未定混在一批里，各自的分位口径不许串。"""
    pair = _pair()
    known: list[float | None] = [None, 1.0, 0.0]
    batched = predict_mixture_many(pair, PROBES, known_compliance=known)
    single = [
        predict_mixture(pair, row, known_compliance=fact)
        for row, fact in zip(PROBES, known, strict=True)
    ]
    assert batched == single
