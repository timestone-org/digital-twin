"""评估算子：把打分结果折算成指标与两组可画的数。"""

from typing import Any

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    CONTRACT_METRICS,
    OperatorBase,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.frame import (
    Frame,
    frame_input,
    numbers_of,
)
from platform_server.apps.modeling.operators.model import (
    SCORED_PRED,
    SCORED_TRUE,
    TASK_REGRESSION,
)
from platform_server.apps.modeling.operators.payloads import MetricsPayload
from platform_server.apps.modeling.operators.registry import register_operator

# 散点图最多带回多少个点。再多前端也画不出信息，只会把响应撑大
MAX_PAIRS = 500
# 残差直方图的桶数
RESIDUAL_BINS = 20
# 相对误差在真实值为 0 时无定义，那些行不计入
_ZERO = 0.0


@register_operator
class RegressionMetrics(OperatorBase):
    """回归评估：R² / RMSE / MAE / MAPE / 最大误差。"""

    CODE = "regression_metrics"
    NAME = "回归评估"
    DESCRIPTION = "按测试集上的真实值与预测值算回归指标，并给出散点与残差分布"
    CATEGORY = "evaluate"
    ICON = "chart-column"
    INPUTS = (
        PortSpec(
            name="scored",
            contract=CONTRACT_FRAME,
            label="打分",
            description="上游模型在测试集上的真实值与预测值",
        ),
    )
    OUTPUTS = (
        PortSpec(name="metrics", contract=CONTRACT_METRICS, label="指标"),
    )
    # 推理时不评估
    ENABLED_IN_SERVING = False

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """算指标。

        Args: inputs。
        """
        scored = frame_input(inputs, "scored")
        truth, predicted = _columns_of(scored)
        residuals = [
            actual - guess
            for actual, guess in zip(truth, predicted, strict=True)
        ]
        return {
            "metrics": MetricsPayload(
                task=TASK_REGRESSION,
                metrics=_metrics_of(truth, residuals),
                pairs=tuple(zip(truth, predicted, strict=True))[:MAX_PAIRS],
                is_truncated=len(truth) > MAX_PAIRS,
                residual_bins=_histogram(residuals),
            )
        }


def _columns_of(scored: Frame) -> tuple[list[float], list[float]]:
    """取出真实值与预测值两列，顺带把空值挡掉。

    Args: scored。
    """
    truth = numbers_of(scored, SCORED_TRUE)
    predicted = numbers_of(scored, SCORED_PRED)
    if not truth:
        raise OperatorError("测试集一行都没有，算不出指标")
    if any(value is None for value in truth + predicted):
        raise OperatorError("打分结果里有空值，算不出指标")
    return (
        [float(value or _ZERO) for value in truth],
        [float(value or _ZERO) for value in predicted],
    )


def _metrics_of(
    truth: list[float], residuals: list[float]
) -> dict[str, float | None]:
    """五个回归指标。R² 与 MAPE 在无定义时给 None，不给一个假的 0。

    Args: truth, residuals。
    """
    count = len(truth)
    mean = sum(truth) / count
    total = sum((value - mean) ** 2 for value in truth)
    squared = sum(value**2 for value in residuals)
    relatives = [
        abs(residual) / abs(actual)
        for actual, residual in zip(truth, residuals, strict=True)
        if actual != _ZERO
    ]
    return {
        "r2": None if total == _ZERO else 1.0 - squared / total,
        "rmse": (squared / count) ** 0.5,
        "mae": sum(abs(value) for value in residuals) / count,
        "mape": (
            None if not relatives else sum(relatives) / len(relatives) * 100.0
        ),
        "max_error": max(abs(value) for value in residuals),
    }


def _histogram(residuals: list[float]) -> tuple[tuple[float, float, int], ...]:
    """残差分布。全部残差相同时退化成单个桶。

    Args: residuals。
    """
    low, high = min(residuals), max(residuals)
    if low == high:
        return ((low, high, len(residuals)),)
    width = (high - low) / RESIDUAL_BINS
    counts = [0] * RESIDUAL_BINS
    for value in residuals:
        index = min(int((value - low) / width), RESIDUAL_BINS - 1)
        counts[index] += 1
    return tuple(
        (low + width * index, low + width * (index + 1), counts[index])
        for index in range(RESIDUAL_BINS)
    )
