"""诊断类评估算子：残差分析、特征重要性、交叉验证。

与 `evaluate.py` 的区别是问的问题不同：那边答「拟合得好不好」，这边答「错在
哪一边」「哪一列在起作用」。分类都是 `evaluate`，分模块只为把两边各自的行数
压在上限内。
"""

import math
from typing import Any, Literal

import numpy as np
from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    CONTRACT_METRICS,
    CONTRACT_MODEL,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.evaluate import (
    DEFAULT_RESIDUAL_BINS,
    residual_histogram,
    scored_columns_of,
)
from platform_server.apps.modeling.operators.frame import (
    Frame,
    frame_input,
    numbers_of,
    select_rows,
    with_column_values,
    with_roles,
)
from platform_server.apps.modeling.operators.model import (
    TASK_CLASSIFICATION,
    TASK_REGRESSION,
)
from platform_server.apps.modeling.operators.payloads import (
    MetricsPayload,
    ModelPayload,
)
from platform_server.apps.modeling.operators.registry import (
    register_operator,
    registry,
)

# 分母为零的判据，与 `evaluate.py` 那份同义
_ZERO = 0.0


class ResidualAnalysisConfig(OperatorConfig):
    """残差分析的参数。"""

    bins: int = Field(
        default=DEFAULT_RESIDUAL_BINS,
        ge=5,
        le=100,
        title="直方图桶数",
        description="残差分布切成多少个区间",
    )


@register_operator
class ResidualAnalysis(OperatorBase):
    """残差分析：偏在哪一边、散得多开、尾巴有多长。

    ⚠ 与回归评估分开是因为两者回答的问题不同：R² 说「拟合得好不好」，残差统计
    说「错在哪一边」。一个偏均值明显不为零的模型，R² 可以很高——那是系统性偏差，
    只在残差上看得出来。
    """

    CODE = "residual_analysis"
    NAME = "残差分析"
    DESCRIPTION = "看残差偏在哪一边、散得多开，以及它的分布形状"
    CATEGORY = "evaluate"
    ICON = "chart-mixed"
    CONFIG_MODEL = ResidualAnalysisConfig
    INPUTS = (
        PortSpec(
            name="scored",
            contract=CONTRACT_FRAME,
            label="打分",
            description="上游模型在测试集上的真实值与预测值",
        ),
    )
    OUTPUTS = (
        PortSpec(name="metrics", contract=CONTRACT_METRICS, label="残差统计"),
    )
    # 推理时不评估
    ENABLED_IN_SERVING = False

    @property
    def _config(self) -> ResidualAnalysisConfig:
        if not isinstance(
            self.config, ResidualAnalysisConfig
        ):  # pragma: no cover —— 参数由注册表按算子造，型别不会错
            raise OperatorError("残差分析拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """算残差的几个统计量与它的分布。

        Args: inputs。
        """
        truth, predicted = scored_columns_of(frame_input(inputs, "scored"))
        residuals = [
            actual - guess
            for actual, guess in zip(truth, predicted, strict=True)
        ]
        return {
            "metrics": MetricsPayload(
                task=TASK_REGRESSION,
                metrics=_residual_stats(residuals),
                residual_bins=residual_histogram(residuals, self._config.bins),
            )
        }


class FeatureImportanceConfig(OperatorConfig):
    """特征重要性的参数。"""

    repeats: int = Field(
        default=5,
        ge=1,
        le=50,
        title="打乱几遍",
        description="每一列打乱这么多次取平均，遍数越多越稳、越慢",
    )
    random_state: int = Field(
        default=42,
        ge=0,
        title="随机种子",
        description="定住它，同一份数据每次算出来的重要性一样",
    )


@register_operator
class FeatureImportance(OperatorBase):
    """置换重要性：把一列打乱，看模型掉多少分。

    ⚠ 不拿系数绝对值当重要性：那只有在特征已经标准化时才可比，而画布上完全可以
    不接标准化——那时候「单位大的列系数小」会被读成「这列不重要」，是一个看着
    合理的错数。打乱一列再打分是跟量纲无关的，且对任何算法都成立。
    """

    CODE = "feature_importance"
    NAME = "特征重要性"
    DESCRIPTION = "把每一列打乱再打分，掉得越多说明这一列越重要"
    CATEGORY = "evaluate"
    ICON = "chart-column"
    CONFIG_MODEL = FeatureImportanceConfig
    INPUTS = (
        PortSpec(name="model", contract=CONTRACT_MODEL, label="模型"),
        PortSpec(
            name="test",
            contract=CONTRACT_FRAME,
            label="测试集",
            description="带特征列与目标列的那一份，与打分帧不是一回事",
        ),
    )
    OUTPUTS = (
        PortSpec(name="metrics", contract=CONTRACT_METRICS, label="重要性"),
    )
    # 推理时不评估
    ENABLED_IN_SERVING = False

    @property
    def _config(self) -> FeatureImportanceConfig:
        if not isinstance(
            self.config, FeatureImportanceConfig
        ):  # pragma: no cover —— 参数由注册表按算子造，型别不会错
            raise OperatorError("特征重要性拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """逐列打乱再打分，掉的分就是这一列的重要性。

        Args: inputs。
        """
        payload = inputs.get("model")
        if not isinstance(payload, ModelPayload):
            raise OperatorError("输入端口 model 上没有模型")
        test = frame_input(inputs, "test")
        model = _rebuilt(payload)
        return {
            "metrics": MetricsPayload(
                task=payload.task,
                metrics=self._importances(model, payload, test),
            )
        }

    def _importances(
        self, model: OperatorBase, payload: ModelPayload, test: Frame
    ) -> dict[str, float | None]:
        config = self._config
        target = _target_values(test, payload.target_key)
        baseline = _scored_by_task(
            payload.task, target, model.predict_rows(test)
        )
        found: dict[str, float | None] = {}
        for key in payload.feature_keys:
            drops = [
                baseline
                - _scored_by_task(
                    payload.task,
                    target,
                    model.predict_rows(
                        _shuffled(test, key, config.random_state + turn)
                    ),
                )
                for turn in range(config.repeats)
            ]
            found[key] = sum(drops) / len(drops)
        return found


def _residual_stats(residuals: list[float]) -> dict[str, float | None]:
    """残差的五个统计量。

    ⚠ 均值单独列出来：它明显不为零就是系统性偏差，而 R² 看不出这一点。
    Args: residuals。
    """
    count = len(residuals)
    mean = sum(residuals) / count
    variance = sum((value - mean) ** 2 for value in residuals) / count
    ordered = sorted(residuals)
    return {
        "residual_mean": mean,
        "residual_std": variance**0.5,
        "residual_p05": _percentile(ordered, 0.05),
        "residual_p95": _percentile(ordered, 0.95),
        "residual_max_abs": max(abs(value) for value in residuals),
    }


def _percentile(ordered: list[float], ratio: float) -> float:
    """有序残差上的线性插值分位数。

    Args: ordered, ratio。
    """
    position = ratio * (len(ordered) - 1)
    low = math.floor(position)
    high = math.ceil(position)
    if low == high:
        return ordered[low]
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def _rebuilt(payload: ModelPayload) -> OperatorBase:
    """按模型描述把那个算子重建出来，只为了拿它的 `predict_rows`。

    ⚠ 超参就是那个算子的配置**原样**——两者漂了的话这里会拿一份不完整的配置
    去构造，而构造得出来、算出来的数却是另一个模型的。契约用例钉住这一条。
    Args: payload。
    """
    model, _ = registry.build(payload.algo, dict(payload.hyper_params))
    model.bind_runtime(tz_offset_minutes=0, split_plan=None)
    model.load_fitted(dict(payload.fitted))
    return model


def _target_values(test: Frame, target_key: str) -> list[float]:
    """测试集上的真实值。

    Args: test, target_key。
    """
    values = numbers_of(test, target_key)
    if any(value is None for value in values):
        raise OperatorError("测试集的目标列里有空值，算不出重要性")
    return [float(value or _ZERO) for value in values]


def _scored_by_task(
    task: str, truth: list[float], predicted: list[float]
) -> float:
    """按任务挑一个「越大越好」的分：回归用 R²，分类用准确率。

    Args: task, truth, predicted。
    """
    if task == TASK_CLASSIFICATION:
        hit = sum(
            1
            for actual, guess in zip(truth, predicted, strict=True)
            if actual == guess
        )
        return hit / len(truth)
    mean = sum(truth) / len(truth)
    total = sum((value - mean) ** 2 for value in truth)
    if total == _ZERO:
        raise OperatorError("测试集的目标列没有变化，算不出重要性")
    squared = sum(
        (actual - guess) ** 2
        for actual, guess in zip(truth, predicted, strict=True)
    )
    return 1.0 - squared / total


def _shuffled(frame: Frame, key: str, seed: int) -> Frame:
    """把一列的取值打乱，其余原样。

    ⚠ 种子定死：不定的话同一份数据每次算出来的重要性都不一样，而用户会以为
    是模型在变。
    Args: frame, key, seed。
    """
    values = frame.values_of(key)
    generator = np.random.default_rng(seed)
    order = [int(item) for item in generator.permutation(len(values))]
    return with_column_values(frame, key, [values[index] for index in order])


# 折数的上下限
MIN_FOLDS = 2
MAX_FOLDS = 20

type FoldMethod = Literal["forward_chain", "kfold"]


class CrossValidateConfig(OperatorConfig):
    """交叉验证的参数。"""

    folds: int = Field(
        default=5,
        ge=MIN_FOLDS,
        le=MAX_FOLDS,
        title="折数",
        description="切成这么多份轮流当测试集",
    )
    method: FoldMethod = Field(
        default="forward_chain",
        title="怎么折",
        description=(
            "forward_chain=前向链，每一折都拿它之前的行训、这一折的行测；"
            "kfold=顺序等分轮流当测试集；"
            "⚠ 时序数据用 kfold 会拿未来的行去训练过去的行，指标虚高"
        ),
    )


@register_operator
class CrossValidate(OperatorBase):
    """把同一套配置在若干折上各训一遍，看指标稳不稳。

    ⚠ 默认**前向链**而不是等分 K 折：台账数据是时序的，等分折会拿未来的行去训
    过去的行，指标虚高而上线崩——这与切分算子默认时序切是同一条理由。
    ⚠ 它读的是**建模那一步的算法与超参**，自己不认识任何具体算法：加一个新的
    建模算子时这里不用改。
    """

    CODE = "cross_validate"
    NAME = "交叉验证"
    DESCRIPTION = "在若干折上各训一遍，给出每折指标与它们的均值和波动"
    CATEGORY = "evaluate"
    ICON = "refresh-cw"
    CONFIG_MODEL = CrossValidateConfig
    INPUTS = (
        PortSpec(name="model", contract=CONTRACT_MODEL, label="模型"),
        PortSpec(
            name="frame",
            contract=CONTRACT_FRAME,
            label="全量数据",
            description="切分**之前**那一份——交叉验证要自己切",
        ),
    )
    OUTPUTS = (
        PortSpec(name="metrics", contract=CONTRACT_METRICS, label="指标"),
    )
    # 推理时不评估
    ENABLED_IN_SERVING = False

    @property
    def _config(self) -> CrossValidateConfig:
        if not isinstance(
            self.config, CrossValidateConfig
        ):  # pragma: no cover —— 参数由注册表按算子造，型别不会错
            raise OperatorError("交叉验证拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """逐折训练、逐折打分，最后给均值与波动。

        Args: inputs。
        """
        payload = inputs.get("model")
        if not isinstance(payload, ModelPayload):
            raise OperatorError("输入端口 model 上没有模型")
        frame = with_roles(
            frame_input(inputs, "frame"), target_key=payload.target_key
        )
        scores = [
            _fold_score(payload, frame, train, test)
            for train, test in _folds(
                frame.row_count, self._config.folds, self._config.method
            )
        ]
        return {
            "metrics": MetricsPayload(
                task=payload.task, metrics=_summary(scores)
            )
        }


def _folds(
    row_count: int, folds: int, method: FoldMethod
) -> list[tuple[list[int], list[int]]]:
    """每一折的训练行与测试行下标。

    ⚠ 前向链只出 `folds - 1` 折：第一块没有「它之前的行」可以训。
    Args: row_count, folds, method。
    """
    width = row_count // folds
    if width < 1:
        raise OperatorError(
            f"只有 {row_count} 行，切不出 {folds} 折——请减少折数或多取些数据"
        )
    made: list[tuple[list[int], list[int]]] = []
    for index in range(folds):
        start = index * width
        stop = row_count if index == folds - 1 else start + width
        test = list(range(start, stop))
        train = (
            list(range(start))
            if method == "forward_chain"
            else [item for item in range(row_count) if item not in set(test)]
        )
        if train:
            made.append((train, test))
    if not made:
        raise OperatorError("一折都切不出来，请检查折数与数据量")
    return made


def _fold_score(
    payload: ModelPayload, frame: Frame, train: list[int], test: list[int]
) -> float:
    """一折上的分：回归给 R²，分类给准确率。

    Args: payload, frame, train, test。
    """
    model, _ = registry.build(payload.algo, dict(payload.hyper_params))
    model.bind_runtime(tz_offset_minutes=0, split_plan=None)
    model.run(
        {
            "train": select_rows(frame, train),
            "test": select_rows(frame, test),
        }
    )
    tested = select_rows(frame, test)
    truth = [
        float(value or _ZERO)
        for value in numbers_of(tested, payload.target_key)
    ]
    return _scored_by_task(payload.task, truth, model.predict_rows(tested))


def _summary(scores: list[float]) -> dict[str, float | None]:
    """每折的分折成三个数：均值、波动、最差的那一折。

    ⚠ 只给均值是不够的：几折之间差得很远才是这条评估要说的事——那意味着模型
    对切在哪儿很敏感，换一段数据就不灵了。
    Args: scores。
    """
    mean = sum(scores) / len(scores)
    variance = sum((value - mean) ** 2 for value in scores) / len(scores)
    return {
        "folds": float(len(scores)),
        "score_mean": mean,
        "score_std": variance**0.5,
        "score_worst": min(scores),
    }
