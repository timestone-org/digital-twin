"""系数型线性模型：线性回归与二分类逻辑回归。

两个算子共用同一副拟合参数形状（按列 key 建键的 `coef` + `intercept`）与同一条
上线通道（通道 A / JSON），因此放在一起；切分与打分帧的公共口径在 `model.py`。
"""

import math
from typing import Any, cast

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    CONTRACT_MODEL,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.estimators import (
    BinaryLogit,
    LeastSquares,
    Regularization,
    logistic_probability,
)
from platform_server.apps.modeling.operators.frame import (
    ROLE_FEATURE,
    Frame,
    frame_input,
    matrix_of,
    numbers_of,
)
from platform_server.apps.modeling.operators.model import (
    SCORED_PRED,
    SCORED_TRUE,
    TASK_CLASSIFICATION,
    TASK_REGRESSION,
    scored_frame,
    single_target,
)
from platform_server.apps.modeling.operators.payloads import ModelPayload
from platform_server.apps.modeling.operators.registry import register_operator

# 判成正类的概率门槛
_DECISION_THRESHOLD = 0.5
# 两类模型的类目个数
_TWO_CLASSES = 2


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
            "none=普通最小二乘；ridge=岭回归，按 alpha 收缩系数（截距不参与）"
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
        target_key = single_target(train)
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
            "scored": scored_frame(test, target_key, self.predict_rows(test)),
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


def _hyper_params_of(config: LinearRegressionConfig) -> dict[str, Any]:
    """落进模型版本、供模型卡展示的超参。

    Args: config。
    """
    return {
        "use_intercept": config.use_intercept,
        "regularization": config.regularization,
        "ridge_alpha": config.ridge_alpha,
    }


def _is_finite(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(float(value))


def _linear_config(config: OperatorConfig) -> LinearRegressionConfig:
    # pragma 理由 —— 参数由注册表按算子造，型别不会错
    if not isinstance(config, LinearRegressionConfig):  # pragma: no cover
        raise OperatorError("线性回归拿到了不匹配的参数")
    return config


class LogisticRegressionConfig(OperatorConfig):
    """逻辑回归的参数。"""

    use_intercept: bool = Field(
        default=True,
        title="拟合截距",
        description="关掉相当于强制过原点，一般不要关",
    )
    regularization_strength: float = Field(
        default=1.0,
        gt=0.0,
        title="正则化强度的倒数",
        description="越小罚得越狠；它就是 sklearn 那个 C",
    )


@register_operator
class LogisticRegressionOperator(OperatorBase):
    """二分类逻辑回归。拟合参数是纯数，可以直接上线（通道 A）。

    ⚠ 目标列必须是**数值**的两类（比如 0 / 1）：切分算子只认数值目标列。
    文本类目先用「类型归一」转成数值。
    """

    CODE = "logistic_regression"
    NAME = "逻辑回归"
    DESCRIPTION = "在训练集上拟合一个两类判别模型，并在测试集上打分"
    CATEGORY = "model"
    ICON = "chart-pie"
    CONFIG_MODEL = LogisticRegressionConfig
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
            description="测试集上的真实类目与预测类目，供评估算子算指标",
        ),
    )
    REQUIRES_FIT = True
    SERVING_CHANNEL = "json"

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._coef: dict[str, float] = {}
        self._intercept = 0.0
        self._classes: list[float] = []

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """打分帧是新造的两列，与两个输入的列集无关。

        Args: config, inputs。
        """
        del config, inputs
        return {"scored": (SCORED_TRUE, SCORED_PRED)}

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """在训练集上拟合，在测试集上打分。

        Args: inputs。
        """
        train = frame_input(inputs, "train")
        test = frame_input(inputs, "test")
        feature_keys = train.keys_by_role(ROLE_FEATURE)
        target_key = single_target(train)
        if not feature_keys:
            raise OperatorError("训练集里一个特征列都没有")
        self._fit(train, feature_keys, target_key)
        return {
            "model": ModelPayload(
                algo=self.CODE,
                task=TASK_CLASSIFICATION,
                feature_keys=feature_keys,
                target_key=target_key,
                hyper_params=_logit_hyper_params(_logit_config(self.config)),
                fitted=self.dump_fitted() or {},
                serving_channel=self.SERVING_CHANNEL,
            ),
            "scored": scored_frame(test, target_key, self.predict_rows(test)),
        }

    def predict_rows(self, frame: Frame) -> list[float]:
        """按拟合参数给每一行判一个**类目**。

        ⚠ 给的是类目不是概率：台账那一格与第三方接口拿到的都是「判成哪一类」。
        概率想看的话在打分帧上另开一列，那是下一轮的事。
        Args: frame。
        """
        if not self._coef:
            raise OperatorError("模型还没有拟合参数")
        keys = tuple(self._coef)
        coef = [self._coef[key] for key in keys]
        rows = matrix_of(frame, keys)
        return [
            self._classes[
                (
                    1
                    if logistic_probability(coef, self._intercept, row)
                    >= _DECISION_THRESHOLD
                    else 0
                )
            ]
            for row in rows
        ]

    def dump_fitted(self) -> dict[str, Any] | None:
        """按列 key 建键的系数、截距与两个类目。"""
        return {
            "coef": dict(self._coef),
            "intercept": self._intercept,
            "classes": list(self._classes),
        }

    def load_fitted(self, params: dict[str, Any]) -> None:
        """回灌系数、截距与类目。

        Args: params。
        """
        self.validate_fitted(params)
        coef = cast("dict[str, object]", params["coef"])
        self._coef = {key: float(str(value)) for key, value in coef.items()}
        self._intercept = float(params["intercept"])
        self._classes = [
            float(str(item)) for item in cast("list[object]", params["classes"])
        ]

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """系数按列 key 建键、都是有限数，且恰好带两个类目。

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
            raise OperatorError("模型的截距不是有限数")
        classes: object = params.get("classes")
        if not isinstance(classes, list):
            raise OperatorError("两类模型必须恰好带两个类目")
        if len(cast("list[object]", classes)) != _TWO_CLASSES:
            raise OperatorError("两类模型必须恰好带两个类目")

    def _fit(
        self, train: Frame, feature_keys: tuple[str, ...], target_key: str
    ) -> None:
        config = _logit_config(self.config)
        target = numbers_of(train, target_key)
        if any(value is None for value in target):
            raise OperatorError("训练集的目标列里有空值，请先补一个填缺失")
        estimator = BinaryLogit(
            use_intercept=config.use_intercept,
            regularization_strength=config.regularization_strength,
        )
        estimator.fit(
            matrix_of(train, feature_keys),
            [float(value or 0.0) for value in target],
        )
        self._coef = dict(zip(feature_keys, estimator.coef, strict=True))
        self._intercept = estimator.intercept
        self._classes = estimator.classes


def _logit_config(config: OperatorConfig) -> LogisticRegressionConfig:
    # pragma 理由 —— 参数由注册表按算子造，型别不会错
    if not isinstance(config, LogisticRegressionConfig):  # pragma: no cover
        raise OperatorError("逻辑回归拿到了不匹配的参数")
    return config


def _logit_hyper_params(config: LogisticRegressionConfig) -> dict[str, Any]:
    """落进模型描述里的超参，界面上照它显示。

    Args: config。
    """
    return {
        "use_intercept": config.use_intercept,
        "regularization_strength": config.regularization_strength,
    }
