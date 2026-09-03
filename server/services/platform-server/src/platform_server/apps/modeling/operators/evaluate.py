"""评估算子：把打分结果折算成指标与几组可画的数。

⚠ 分母为 0 的指标一律给 `None` 而不是 0：R²、MAPE、精确率、召回率各有各的
无定义情形，显示成 0 读起来像「模型很差」，而实际是「这个数算不出来」。
"""

from typing import Any

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    CONTRACT_METRICS,
    OperatorBase,
    OperatorConfig,
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
    TASK_CLASSIFICATION,
    TASK_REGRESSION,
)
from platform_server.apps.modeling.operators.payloads import MetricsPayload
from platform_server.apps.modeling.operators.registry import register_operator

# 散点图默认带回多少个点。再多前端也画不出信息，只会把响应撑大
DEFAULT_SCATTER_POINTS = 500
# 残差直方图的默认桶数
DEFAULT_RESIDUAL_BINS = 20
# 相对误差在真实值为 0 时无定义，那些行不计入
_ZERO = 0.0


def _ratio(part: int, whole: int) -> float | None:
    """分母为 0 时给 `None`，不给 0。

    Args: part, whole。
    """
    return None if whole == 0 else part / whole


class RegressionMetricsConfig(OperatorConfig):
    """回归评估的参数。两项都只影响带回来画图的那两组数，不影响指标。"""

    residual_bins: int = Field(
        default=DEFAULT_RESIDUAL_BINS,
        ge=5,
        le=100,
        title="残差直方图桶数",
        description="残差分布切成多少个区间",
    )
    max_scatter_points: int = Field(
        default=DEFAULT_SCATTER_POINTS,
        ge=50,
        le=5000,
        title="散点图点数上限",
        description="真实-预测散点最多带回多少个点，超出的部分标为已截断",
    )


@register_operator
class RegressionMetrics(OperatorBase):
    """回归评估：R² / RMSE / MAE / MAPE / 最大误差。"""

    CODE = "regression_metrics"
    NAME = "回归评估"
    DESCRIPTION = "按测试集上的真实值与预测值算回归指标，并给出散点与残差分布"
    CATEGORY = "evaluate"
    ICON = "chart-column"
    CONFIG_MODEL = RegressionMetricsConfig
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

    @property
    def _config(self) -> RegressionMetricsConfig:
        config = self.config
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(config, RegressionMetricsConfig):  # pragma: no cover
            raise OperatorError("回归评估拿到了不匹配的参数")
        return config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """算指标。

        Args: inputs。
        """
        config = self._config
        scored = frame_input(inputs, "scored")
        truth, predicted = scored_columns_of(scored)
        residuals = [
            actual - guess
            for actual, guess in zip(truth, predicted, strict=True)
        ]
        limit = config.max_scatter_points
        return {
            "metrics": MetricsPayload(
                task=TASK_REGRESSION,
                metrics=_metrics_of(truth, residuals),
                pairs=tuple(zip(truth, predicted, strict=True))[:limit],
                is_truncated=len(truth) > limit,
                residual_bins=residual_histogram(
                    residuals, config.residual_bins
                ),
            )
        }


def scored_columns_of(scored: Frame) -> tuple[list[float], list[float]]:
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


def residual_histogram(
    residuals: list[float], bins: int
) -> tuple[tuple[float, float, int], ...]:
    """残差分布。全部残差相同时退化成单个桶。

    Args: residuals, bins。
    """
    low, high = min(residuals), max(residuals)
    if low == high:
        return ((low, high, len(residuals)),)
    width = (high - low) / bins
    counts = [0] * bins
    for value in residuals:
        index = min(int((value - low) / width), bins - 1)
        counts[index] += 1
    return tuple(
        (low + width * index, low + width * (index + 1), counts[index])
        for index in range(bins)
    )


class ClassificationMetricsConfig(OperatorConfig):
    """分类评估的参数。"""

    positive_label: float = Field(
        default=1.0,
        title="哪一类算「正类」",
        description="精确率 / 召回率 / F1 都是相对它算的",
    )


@register_operator
class ClassificationMetrics(OperatorBase):
    """分类评估：准确率 / 精确率 / 召回率 / F1 + 混淆矩阵。"""

    CODE = "classification_metrics"
    NAME = "分类评估"
    DESCRIPTION = "按测试集上的真实类目与预测类目算分类指标，并给出混淆矩阵"
    CATEGORY = "evaluate"
    ICON = "list-checks"
    CONFIG_MODEL = ClassificationMetricsConfig
    INPUTS = (
        PortSpec(
            name="scored",
            contract=CONTRACT_FRAME,
            label="打分",
            description="上游模型在测试集上的真实类目与预测类目",
        ),
    )
    OUTPUTS = (
        PortSpec(name="metrics", contract=CONTRACT_METRICS, label="指标"),
    )
    # 推理时不评估
    ENABLED_IN_SERVING = False

    @property
    def _config(self) -> ClassificationMetricsConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(
            self.config, ClassificationMetricsConfig
        ):  # pragma: no cover —— 参数由注册表按算子造，型别不会错
            raise OperatorError("分类评估拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """算四个指标与一张混淆矩阵。

        Args: inputs。
        """
        scored = frame_input(inputs, "scored")
        truth, predicted = _scored_pairs(scored)
        labels = sorted({*truth, *predicted})
        positive = self._config.positive_label
        return {
            "metrics": MetricsPayload(
                task=TASK_CLASSIFICATION,
                metrics=_classification_scores(truth, predicted, positive),
                labels=tuple(_label_text(item) for item in labels),
                matrix=_confusion(truth, predicted, labels),
            )
        }


def _scored_pairs(scored: Frame) -> tuple[list[float], list[float]]:
    """打分帧上的两列，成对取出来。

    Args: scored。
    """
    truth = numbers_of(scored, SCORED_TRUE)
    predicted = numbers_of(scored, SCORED_PRED)
    if any(value is None for value in (*truth, *predicted)):
        raise OperatorError("打分结果里有空值，算不出分类指标")
    return (
        [float(value or 0.0) for value in truth],
        [float(value or 0.0) for value in predicted],
    )


def _classification_scores(
    truth: list[float], predicted: list[float], positive: float
) -> dict[str, float | None]:
    """四个指标。分母为 0 的那几个给 `None`，不给 0。

    ⚠ 「没有一条被判成正类」与「判成正类的全错了」都会让精确率的分母是 0，
    而两者都不该显示成 0——那读起来像「模型很差」，实际是「这个数没有定义」。
    Args: truth, predicted, positive。
    """
    hit = sum(
        1
        for actual, guess in zip(truth, predicted, strict=True)
        if actual == guess
    )
    true_positive = _counted(truth, predicted, positive, positive)
    false_positive = _counted(truth, predicted, None, positive)
    false_negative = _counted(truth, predicted, positive, None)
    precision = _ratio(true_positive, true_positive + false_positive)
    recall = _ratio(true_positive, true_positive + false_negative)
    return {
        "accuracy": _ratio(hit, len(truth)),
        "precision": precision,
        "recall": recall,
        "f1": _harmonic(precision, recall),
    }


def _counted(
    truth: list[float],
    predicted: list[float],
    actual: float | None,
    guess: float | None,
) -> int:
    """真实 / 预测各自等于（或不等于）某一类的行数。`None` 表示「不是那一类」。

    Args: truth, predicted, actual, guess。
    """
    total = 0
    for left, right in zip(truth, predicted, strict=True):
        actual_ok = left != guess if actual is None else left == actual
        guess_ok = right != actual if guess is None else right == guess
        if actual_ok and guess_ok:
            total += 1
    return total


def _confusion(
    truth: list[float], predicted: list[float], labels: list[float]
) -> tuple[tuple[int, ...], ...]:
    """混淆矩阵：第 i 行第 j 列 = 真实是第 i 类而判成第 j 类的行数。

    Args: truth, predicted, labels。
    """
    index = {label: position for position, label in enumerate(labels)}
    counts = [[0 for _ in labels] for _ in labels]
    for actual, guess in zip(truth, predicted, strict=True):
        counts[index[actual]][index[guess]] += 1
    return tuple(tuple(row) for row in counts)


def _label_text(value: float) -> str:
    """类目在界面上的写法：整数就不带小数点。

    Args: value。
    """
    return str(int(value)) if value.is_integer() else str(value)


def _harmonic(left: float | None, right: float | None) -> float | None:
    """两个比率的调和平均；任一无定义或两者皆零时给 `None`。

    Args: left, right。
    """
    if left is None or right is None or left + right == _ZERO:
        return None
    return 2 * left * right / (left + right)
