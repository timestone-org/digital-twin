"""分类那条路：逻辑回归判两类、分类评估算指标与混淆矩阵。

⚠ 指标全部手算核对：`accuracy` 这种数「看着合理」与「算对了」相差很远，
而分类指标里分母为 0 的情形特别多——每一个都要显式验成 `None` 而不是 0。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    MetricsPayload,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.frame import (
    ROLE_FEATURE,
    ROLE_TARGET,
)

FEATURE = "温度"
TARGET = "报警"
SCORED_TRUE = "y_true"
SCORED_PRED = "y_pred"


def _training(rows: list[tuple[float, float]]) -> Frame:
    """一列特征、一列两类目标的训练帧。

    Args: rows。
    """
    return Frame(
        columns=(
            FrameColumn(
                key=FEATURE, name=FEATURE, dtype="number", role=ROLE_FEATURE
            ),
            FrameColumn(
                key=TARGET, name=TARGET, dtype="number", role=ROLE_TARGET
            ),
        ),
        rows=tuple(rows),
    )


def _scored(rows: list[tuple[float, float]]) -> Frame:
    """真实类目与预测类目两列。

    Args: rows。
    """
    return Frame(
        columns=(
            FrameColumn(key=SCORED_TRUE, name="真实", dtype="number"),
            FrameColumn(key=SCORED_PRED, name="预测", dtype="number"),
        ),
        rows=tuple(rows),
    )


def _fitted_logit(rows: list[tuple[float, float]]) -> Any:
    """在给定训练帧上拟合一个逻辑回归。

    Args: rows。
    """
    operator, _ = registry.build("logistic_regression", {})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    frame = _training(rows)
    operator.run({"train": frame, "test": frame})
    return operator


def _metrics(scored: Frame, **config: Any) -> MetricsPayload:
    """跑一遍分类评估。

    Args: scored, config。
    """
    operator, _ = registry.build("classification_metrics", config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    payload = operator.run({"scored": scored})["metrics"]
    assert isinstance(payload, MetricsPayload)
    return payload


SEPARABLE = [
    (1.0, 0.0),
    (2.0, 0.0),
    (3.0, 0.0),
    (8.0, 1.0),
    (9.0, 1.0),
    (10.0, 1.0),
]


def test_a_separable_set_is_classified_perfectly() -> None:
    """两类分得开时，判出来的类目与真实一模一样。"""
    operator = _fitted_logit(SEPARABLE)
    got = operator.predict_rows(_training(SEPARABLE))
    assert got == [0.0, 0.0, 0.0, 1.0, 1.0, 1.0]


def test_the_model_reports_the_classification_task() -> None:
    """产出的模型说自己是分类，评估那一侧照它挑指标。"""
    operator = _fitted_logit(SEPARABLE)
    payload = operator.run(
        {"train": _training(SEPARABLE), "test": _training(SEPARABLE)}
    )["model"]
    assert payload.task == "classification"
    assert payload.serving_channel == "json"


def test_the_fitted_params_round_trip_and_predict_the_same() -> None:
    """回灌之后判出来的类目与训练那一侧一致。

    ⚠ 类目也要跟着存：只存系数与截距的话，回灌出来的模型只判得出 0 / 1，
    而真实类目可能是别的两个数。
    """
    trained = _fitted_logit(SEPARABLE)
    served, _ = registry.build("logistic_regression", {})
    served.bind_runtime(tz_offset_minutes=0, split_plan=None)
    served.load_fitted(trained.dump_fitted() or {})
    frame = _training(SEPARABLE)
    assert served.predict_rows(frame) == trained.predict_rows(frame)


def test_labels_other_than_zero_and_one_survive() -> None:
    """类目是 3 与 7 时，判出来的也是 3 与 7。"""
    rows = [(1.0, 3.0), (2.0, 3.0), (9.0, 7.0), (10.0, 7.0)]
    got = _fitted_logit(rows).predict_rows(_training(rows))
    assert set(got) == {3.0, 7.0}


def test_three_classes_are_refused_with_a_readable_reason() -> None:
    """三个类目当场说清楚，不悄悄挑两个出来算。"""
    rows = [(1.0, 0.0), (2.0, 1.0), (3.0, 2.0)]
    with pytest.raises(OperatorError, match="只做两类"):
        _fitted_logit(rows)


def test_the_scores_are_hand_checkable() -> None:
    """四个指标手算核对。

    真实 [1,1,1,0,0]，预测 [1,1,0,0,1]：命中 3/5；正类判了 3 次中 2 次；
    正类共 3 个召回 2 个。
    """
    payload = _metrics(
        _scored([(1.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0), (0.0, 1.0)])
    )
    assert payload.metrics["accuracy"] == pytest.approx(0.6)
    assert payload.metrics["precision"] == pytest.approx(2 / 3)
    assert payload.metrics["recall"] == pytest.approx(2 / 3)
    assert payload.metrics["f1"] == pytest.approx(2 / 3)


def test_a_metric_without_a_denominator_is_null_not_zero() -> None:
    """一条都没判成正类时，精确率是「算不出来」而不是 0。

    ⚠ 显示成 0 读起来像「模型很差」，而实际是这个数没有定义。
    """
    payload = _metrics(_scored([(1.0, 0.0), (1.0, 0.0)]))
    assert payload.metrics["precision"] is None
    assert payload.metrics["f1"] is None
    assert payload.metrics["recall"] == pytest.approx(0.0)


def test_the_confusion_matrix_counts_every_row_once() -> None:
    """混淆矩阵按类目升序排，格子加起来等于总行数。"""
    payload = _metrics(
        _scored([(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 1.0)])
    )
    assert payload.labels == ("0", "1")
    assert payload.matrix == ((1, 1), (0, 2))
    assert sum(sum(row) for row in payload.matrix) == 4


def test_the_positive_class_can_be_the_other_one() -> None:
    """挑另一类当正类时，精确率与召回率跟着换。"""
    scored = _scored([(0.0, 0.0), (0.0, 1.0), (1.0, 1.0)])
    assert _metrics(scored, positive_label=0.0).metrics[
        "recall"
    ] == pytest.approx(0.5)
    assert _metrics(scored, positive_label=1.0).metrics[
        "recall"
    ] == pytest.approx(1.0)
