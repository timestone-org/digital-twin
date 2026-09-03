"""建模算子：切分训练 / 测试，以及在训练集上拟合出一个模型。"""

import math
from typing import Any, Literal, cast

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    CONTRACT_MODEL,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
    column_field,
)
from platform_server.apps.modeling.operators.estimators import (
    LeastSquares,
    Regularization,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    ROLE_FEATURE,
    ROLE_TARGET,
    SPLIT_METHODS,
    SPLIT_TIME_ORDER,
    Frame,
    FrameColumn,
    frame_input,
    matrix_of,
    numbers_of,
    select_rows,
    split_row_indices,
    with_roles,
)
from platform_server.apps.modeling.operators.payloads import ModelPayload
from platform_server.apps.modeling.operators.registry import register_operator

TASK_REGRESSION = "regression"
# 打分帧上的两列，评估算子按它们取数
SCORED_TRUE = "y_true"
SCORED_PRED = "y_pred"

type SplitMethod = Literal["time_order", "random"]


class SplitDatasetConfig(OperatorConfig):
    """切分的参数。目标列在这里**一次性**指定，下游从列角色读。"""

    target_column: str = column_field(
        title="目标列", description="要预测的那一列"
    )
    method: SplitMethod = Field(
        default=SPLIT_TIME_ORDER,
        title="切分方式",
        description=(
            # ⚠ 警告要单独成段：前端按「值=说明；值=说明」拆这句话去做下拉的
            # 选项文案，跟在 `random=` 后面的话，整句警告就变成了那一项的标签
            "time_order=按时间先后切，靠后的做测试集；"
            "random=随机切；"
            "⚠ 台账数据是时序的，随机切会让未来数据泄漏进训练集"
        ),
    )
    test_ratio: float = Field(default=0.2, gt=0.0, lt=1.0, title="测试集比例")
    random_state: int = Field(
        default=42, ge=0, title="随机种子", description="随机切分时才用得上"
    )
    min_test_rows: int = Field(
        default=1,
        ge=1,
        title="测试集最少行数",
        description="切出来的测试集少于这么多行就当场报错，不往下跑",
    )


@register_operator
class SplitDataset(OperatorBase):
    """切出训练集与测试集，并把目标列的角色打上。"""

    CODE = "split_dataset"
    NAME = "训练测试切分"
    DESCRIPTION = "按时序或随机切出训练集与测试集，并指定要预测的目标列"
    CATEGORY = "model"
    ICON = "layers"
    CONFIG_MODEL = SplitDatasetConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (
        PortSpec(name="train", contract=CONTRACT_FRAME, label="训练集"),
        PortSpec(name="test", contract=CONTRACT_FRAME, label="测试集"),
    )
    # 推理时只有一行，没有切分可言
    ENABLED_IN_SERVING = False
    CHANGES_ROW_COUNT = True
    PROVIDES_SPLIT_PLAN = True

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """切两份出来，两份都带上列角色。

        Args: inputs。
        """
        config = _split_config(self.config)
        frame = with_roles(
            frame_input(inputs, "frame"), target_key=config.target_column
        )
        if frame.column_of(config.target_column).dtype != DTYPE_NUMBER:
            raise OperatorError("目标列必须是数值列")
        train, test = split_row_indices(
            frame.row_count,
            method=config.method,
            test_ratio=config.test_ratio,
            random_state=config.random_state,
        )
        _check_test_rows(config, test_rows=len(test), row_count=frame.row_count)
        return {
            "train": select_rows(frame, sorted(train)),
            "test": select_rows(frame, sorted(test)),
        }


class LinearRegressionConfig(OperatorConfig):
    """线性回归的参数。"""

    use_intercept: bool = Field(
        default=True,
        title="拟合截距",
        description="关掉相当于强制过原点，一般不要关",
    )
    regularization: Regularization = Field(
        default="none",
        title="正则化",
        description=(
            "none=普通最小二乘；"
            "ridge=岭回归，按 alpha 收缩系数（截距不参与）"
        ),
    )
    ridge_alpha: float = Field(
        default=1.0,
        ge=0.0,
        title="岭回归的 alpha",
        description="正则化选 ridge 时才用得上，越大系数收得越狠",
    )


@register_operator
class LinearRegressionOperator(OperatorBase):
    """最小二乘线性回归。拟合参数是纯数，因此可以直接上线（通道 A）。"""

    CODE = "linear_regression"
    NAME = "线性回归"
    DESCRIPTION = "在训练集上拟合一条线性关系，并在测试集上打分"
    CATEGORY = "model"
    ICON = "chart-line"
    CONFIG_MODEL = LinearRegressionConfig
    INPUTS = (
        PortSpec(name="train", contract=CONTRACT_FRAME, label="训练集"),
        PortSpec(name="test", contract=CONTRACT_FRAME, label="测试集"),
    )
    OUTPUTS = (
        PortSpec(name="model", contract=CONTRACT_MODEL, label="模型"),
        PortSpec(
            name="scored",
            contract=CONTRACT_FRAME,
            label="打分",
            description="测试集上的真实值与预测值，供评估算子算指标",
        ),
    )
    REQUIRES_FIT = True
    SERVING_CHANNEL = "json"

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._coef: dict[str, float] = {}
        self._intercept = 0.0

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """在训练集上拟合，在测试集上打分。

        Args: inputs。
        """
        train = frame_input(inputs, "train")
        test = frame_input(inputs, "test")
        feature_keys = train.keys_by_role(ROLE_FEATURE)
        target_key = _single_target(train)
        if not feature_keys:
            raise OperatorError("训练集里一个特征列都没有")
        self._fit(train, feature_keys, target_key)
        return {
            "model": ModelPayload(
                algo=self.CODE,
                task=TASK_REGRESSION,
                feature_keys=feature_keys,
                target_key=target_key,
                hyper_params=_hyper_params_of(_linear_config(self.config)),
                fitted=self.dump_fitted() or {},
                serving_channel=self.SERVING_CHANNEL,
            ),
            "scored": _scored_frame(test, target_key, self.predict_rows(test)),
        }

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """打分帧是**新造**的两列，与两个输入的列集无关。

        ⚠ 默认的恒等实现在这里是错的：它会把训练集那一堆特征列当成打分帧的列，
        于是下游评估节点的列候选里出现一串根本不存在的名字。
        Args: config, inputs。
        """
        del config, inputs
        return {"scored": (SCORED_TRUE, SCORED_PRED)}

    def predict_rows(self, frame: Frame) -> list[float]:
        """按拟合参数给每一行算一个预测值。

        ⚠ 训练期给测试集打分与推理期单行预测走的是**这同一个方法**：各写一份
        的话，线上与离线会算出不同的数而两边看着都对。
        Args: frame。
        """
        if not self._coef:
            raise OperatorError("模型还没有拟合参数")
        keys = tuple(self._coef)
        rows = matrix_of(frame, keys)
        return [
            self._intercept
            + sum(
                self._coef[key] * value
                for key, value in zip(keys, row, strict=True)
            )
            for row in rows
        ]

    def dump_fitted(self) -> dict[str, Any] | None:
        """按列 key 建键的系数与截距。"""
        return {"coef": dict(self._coef), "intercept": self._intercept}

    def load_fitted(self, params: dict[str, Any]) -> None:
        """回灌系数与截距。

        Args: params。
        """
        self.validate_fitted(params)
        coef = cast("dict[str, object]", params["coef"])
        self._coef = {key: float(str(value)) for key, value in coef.items()}
        self._intercept = float(params["intercept"])

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """系数必须按列 key 建键，且都是有限数。

        Args: params。
        """
        raw: object = params.get("coef")
        if not isinstance(raw, dict) or not raw:
            raise OperatorError("模型缺少系数")
        coef = cast("dict[object, object]", raw)
        for key, value in coef.items():
            if not isinstance(key, str):
                raise OperatorError("系数必须按列 key 建键，不能按列下标")
            if not _is_finite(value):
                raise OperatorError(f"列「{key}」的系数不是有限数")
        if not _is_finite(params.get("intercept")):
            raise OperatorError("截距不是有限数")

    def _fit(
        self, train: Frame, feature_keys: tuple[str, ...], target_key: str
    ) -> None:
        target = numbers_of(train, target_key)
        if any(value is None for value in target):
            raise OperatorError("训练集的目标列里有空值，请先补上或去掉这些行")
        config = _linear_config(self.config)
        estimator = LeastSquares(
            use_intercept=config.use_intercept,
            regularization=config.regularization,
            ridge_alpha=config.ridge_alpha,
        )
        estimator.fit(
            matrix_of(train, feature_keys),
            [float(value or 0.0) for value in target],
        )
        self._coef = dict(zip(feature_keys, estimator.coef, strict=True))
        self._intercept = estimator.intercept


def _scored_frame(
    test: Frame, target_key: str, predictions: list[float]
) -> Frame:
    """把测试集的真实值与预测值拼成一份两列的帧。

    Args: test, target_key, predictions。
    """
    truth = numbers_of(test, target_key)
    if any(value is None for value in truth):
        raise OperatorError("测试集的目标列里有空值，无法与预测值对齐")
    rows = tuple(
        (float(actual or 0.0), predicted)
        for actual, predicted in zip(truth, predictions, strict=True)
    )
    columns = (
        FrameColumn(key=SCORED_TRUE, name="真实值", dtype=DTYPE_NUMBER),
        FrameColumn(key=SCORED_PRED, name="预测值", dtype=DTYPE_NUMBER),
    )
    return Frame(
        columns=columns,
        rows=rows,
        index=test.index,
        index_name=test.index_name,
        provenance=test.provenance,
    )


def _check_test_rows(
    config: SplitDatasetConfig, *, test_rows: int, row_count: int
) -> None:
    """测试集行数不够就当场报错，并说清是行太少还是比例太小。

    Args: config, test_rows, row_count。
    """
    if test_rows >= config.min_test_rows:
        return
    raise OperatorError(
        f"测试集只切出 {test_rows} 行，少于要求的 {config.min_test_rows} 行："
        f"一共 {row_count} 行数据，按 {config.test_ratio:.0%} 的比例就这么多。"
        "请把取数的范围放宽，或把测试集比例调大"
    )


def _hyper_params_of(config: LinearRegressionConfig) -> dict[str, Any]:
    """落进模型版本、供模型卡展示的超参。

    Args: config。
    """
    return {
        "use_intercept": config.use_intercept,
        "regularization": config.regularization,
        "ridge_alpha": config.ridge_alpha,
    }


def _single_target(frame: Frame) -> str:
    keys = frame.keys_by_role(ROLE_TARGET)
    if len(keys) != 1:
        raise OperatorError("上游没有指定唯一的目标列，请先接一个切分算子")
    return keys[0]


def _is_finite(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(float(value))


def _split_config(config: OperatorConfig) -> SplitDatasetConfig:
    # pragma 理由 —— 参数由注册表按算子造，型别不会错
    if not isinstance(config, SplitDatasetConfig):  # pragma: no cover
        raise OperatorError("切分拿到了不匹配的参数")
    return config


def _linear_config(config: OperatorConfig) -> LinearRegressionConfig:
    # pragma 理由 —— 参数由注册表按算子造，型别不会错
    if not isinstance(config, LinearRegressionConfig):  # pragma: no cover
        raise OperatorError("线性回归拿到了不匹配的参数")
    return config


__all__ = [
    "SCORED_PRED",
    "SCORED_TRUE",
    "SPLIT_METHODS",
    "TASK_REGRESSION",
    "LinearRegressionOperator",
    "SplitDataset",
]
