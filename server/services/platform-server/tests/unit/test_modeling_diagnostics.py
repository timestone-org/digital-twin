"""诊断类评估：残差统计与置换重要性。

⚠ 置换重要性那一组反复验的是**跟量纲无关**：把一列的单位换个量级，重要性排序
不该跟着变。拿系数绝对值当重要性正是在这里翻车的——「单位大的列系数小」会被
读成「这列不重要」。
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
from platform_server.apps.modeling.operators.payloads import ModelPayload

STRONG = "有用的列"
NOISE = "没用的列"
TARGET = "能耗"
ROWS = 40


def _training(scale: float = 1.0) -> Frame:
    """目标只由 `STRONG` 决定，`NOISE` 与它无关。

    Args: scale（把有用那一列整体放大，用来验重要性与量纲无关）。
    """
    rows = tuple(
        (
            float(index) * scale,
            float((index * 7) % 5),
            float(index) * 3.0 + 10.0,
        )
        for index in range(ROWS)
    )
    return Frame(
        columns=(
            FrameColumn(
                key=STRONG, name=STRONG, dtype="number", role=ROLE_FEATURE
            ),
            FrameColumn(
                key=NOISE, name=NOISE, dtype="number", role=ROLE_FEATURE
            ),
            FrameColumn(
                key=TARGET, name=TARGET, dtype="number", role=ROLE_TARGET
            ),
        ),
        rows=rows,
    )


def _scored(rows: list[tuple[float, float]]) -> Frame:
    return Frame(
        columns=(
            FrameColumn(key="y_true", name="真实", dtype="number"),
            FrameColumn(key="y_pred", name="预测", dtype="number"),
        ),
        rows=tuple(rows),
    )


def _model_of(frame: Frame) -> ModelPayload:
    """在给定帧上训一个线性回归，回它的模型描述。

    Args: frame。
    """
    operator, _ = registry.build("linear_regression", {})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    payload = operator.run({"train": frame, "test": frame})["model"]
    assert isinstance(payload, ModelPayload)
    return payload


def _importance(frame: Frame, **config: Any) -> dict[str, float | None]:
    """跑一遍特征重要性。

    Args: frame, config。
    """
    operator, _ = registry.build("feature_importance", config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    payload = operator.run({"model": _model_of(frame), "test": frame})[
        "metrics"
    ]
    assert isinstance(payload, MetricsPayload)
    return payload.metrics


def _residuals(scored: Frame) -> MetricsPayload:
    operator, _ = registry.build("residual_analysis", {})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    payload = operator.run({"scored": scored})["metrics"]
    assert isinstance(payload, MetricsPayload)
    return payload


def test_the_column_that_drives_the_target_scores_higher() -> None:
    """打乱真正起作用的那一列，分掉得多。"""
    found = _importance(_training())
    strong = found[STRONG]
    noise = found[NOISE]
    assert strong is not None
    assert noise is not None
    assert strong > noise


def test_importance_does_not_move_with_the_unit() -> None:
    """把有用那一列整体放大一千倍，它仍然是更重要的那一个。

    ⚠ 这正是不拿系数绝对值当重要性的理由：放大之后系数会小一千倍。
    """
    found = _importance(_training(scale=1000.0))
    strong = found[STRONG]
    noise = found[NOISE]
    assert strong is not None
    assert noise is not None
    assert strong > noise


def test_the_same_seed_gives_the_same_numbers() -> None:
    """种子定住时两次算出来一模一样——不然用户会以为是模型在变。"""
    frame = _training()
    assert _importance(frame, random_state=7) == _importance(
        frame, random_state=7
    )


def test_a_target_that_never_changes_is_refused() -> None:
    """目标列没有变化时说清楚算不出来，不给一串 0。"""
    flat = Frame(
        columns=(
            FrameColumn(
                key=STRONG, name=STRONG, dtype="number", role=ROLE_FEATURE
            ),
            FrameColumn(
                key=TARGET, name=TARGET, dtype="number", role=ROLE_TARGET
            ),
        ),
        rows=tuple((float(index), 5.0) for index in range(10)),
    )
    with pytest.raises(OperatorError, match="没有变化"):
        _importance(flat)


def test_a_biased_model_shows_it_in_the_residual_mean() -> None:
    """整体偏高两个单位时，残差均值就是 -2。

    ⚠ 这种系统性偏差在 R² 上看不出来——残差均值是唯一说得出它的那个数。
    """
    payload = _residuals(_scored([(1.0, 3.0), (2.0, 4.0), (3.0, 5.0)]))
    assert payload.metrics["residual_mean"] == pytest.approx(-2.0)
    assert payload.metrics["residual_std"] == pytest.approx(0.0)


def test_the_residual_spread_and_tail_are_reported() -> None:
    """散布与最大绝对残差都给出来。"""
    payload = _residuals(_scored([(0.0, 0.0), (0.0, 1.0), (0.0, -5.0)]))
    assert payload.metrics["residual_max_abs"] == pytest.approx(5.0)
    assert payload.metrics["residual_std"] is not None
    assert payload.residual_bins


def test_the_rebuilt_model_predicts_what_the_trained_one_did() -> None:
    """按模型描述重建出来的那个，打分与训练那一侧一致。

    ⚠ 超参必须是那个算子配置的**原样**：漂了的话这里会拿一份不完整的配置去
    构造，构造得出来、算出来的却是另一个模型。
    """
    frame = _training()
    payload = _model_of(frame)
    rebuilt, _ = registry.build(payload.algo, dict(payload.hyper_params))
    rebuilt.bind_runtime(tz_offset_minutes=0, split_plan=None)
    rebuilt.load_fitted(dict(payload.fitted))
    trained, _ = registry.build("linear_regression", {})
    trained.bind_runtime(tz_offset_minutes=0, split_plan=None)
    trained.run({"train": frame, "test": frame})
    assert rebuilt.predict_rows(frame) == trained.predict_rows(frame)
