"""可训练、评估和二进制发布的通用回归与分类模型。"""

import math
from dataclasses import replace
from typing import Any, cast

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    CONTRACT_MODEL,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    ROLE_FEATURE,
    Frame,
    FrameColumn,
    frame_input,
    matrix_of,
    numbers_of,
)
from platform_server.apps.modeling.operators.model import (
    SCORED_PRED,
    SCORED_PROBA,
    SCORED_TRUE,
    scored_frame,
    single_target,
)
from platform_server.apps.modeling.operators.payloads import ModelPayload
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.operators.supervised_boundary import (
    FittedEstimator,
    validate_adoption,
)
from platform_server.apps.modeling.operators.supervised_budget import (
    check_tree_budget,
)
from platform_server.apps.modeling.operators.supervised_config import (
    CLASSIFICATION_LABELS,
    REGRESSION_LABELS,
    SCALED_ALGORITHMS,
    ClassificationModelConfig,
    RegressionModelConfig,
)
from platform_server.apps.modeling.operators.supervised_estimators import (
    classification_estimator,
    regression_estimator,
)
from platform_server.apps.modeling.operators.supervised_report import (
    SupervisedRun,
    supervised_blocks,
)

MAX_TRAIN_ROWS = 100_000
MAX_FEATURES = 128
MAX_CLASSES = 100
MIN_CLASSES = 2
MAX_KERNEL_ROWS = 5000
MAX_MLP_ROWS = 50_000


class SupervisedModel(OperatorBase):
    """监督模型的统一二进制生命周期。"""

    INPUTS = (
        PortSpec(name="train", contract=CONTRACT_FRAME, label="训练集"),
        PortSpec(name="test", contract=CONTRACT_FRAME, label="测试集"),
    )
    OUTPUTS = (
        PortSpec(name="model", contract=CONTRACT_MODEL, label="模型"),
        PortSpec(name="scored", contract=CONTRACT_FRAME, label="测试打分"),
    )
    CATEGORY = "model"
    ICON = "network"
    REQUIRES_FIT = True
    SERVING_CHANNEL = "binary"

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._keys: tuple[str, ...] = ()
        self._classes: tuple[float, ...] = ()
        self._estimator: FittedEstimator | None = None
        self._seen: SupervisedRun | None = None

    @property
    def _settings(self) -> RegressionModelConfig | ClassificationModelConfig:
        if isinstance(
            self.config, (RegressionModelConfig, ClassificationModelConfig)
        ):
            return self.config
        raise OperatorError("监督模型配置类型不匹配")

    @property
    def _is_classification(self) -> bool:
        return self.MODEL_TASK == "classification"

    def run(self, inputs: dict[str, object]) -> dict[str, object]:
        """只在训练集拟合，再对测试集给出同一模型的预测。Args: inputs。"""
        train, test = frame_input(inputs, "train"), frame_input(inputs, "test")
        self._keys = train.keys_by_role(ROLE_FEATURE)
        target = single_target(train)
        _check_budget(train, self._keys, self._settings)
        truth = _target_values(train, target)
        test_truth = _target_values(test, target)
        self._fit(train, truth)
        predicted = self.predict_rows(test)
        scored = self._scored(test, target, predicted)
        self._seen = self._run_details(train, test_truth, predicted)
        return {
            "model": ModelPayload(
                algo=self.CODE,
                task=self.MODEL_TASK or "regression",
                feature_keys=self._keys,
                target_key=target,
                hyper_params=self._settings.model_dump(),
                fitted=self.dump_fitted() or {},
                serving_channel="binary",
            ),
            "scored": scored,
        }

    def _fit(self, train: Frame, target: list[float]) -> None:
        config = self._settings
        if isinstance(config, ClassificationModelConfig):
            self._classes = tuple(sorted(set(target)))
            if not MIN_CLASSES <= len(self._classes) <= MAX_CLASSES:
                raise OperatorError("分类训练需要 2 至 100 个不同的数值类别")
            positions = {
                value: seat for seat, value in enumerate(self._classes)
            }
            target = [float(positions[value]) for value in target]
        check_tree_budget(config, class_count=len(self._classes))
        native = (
            classification_estimator(config)
            if isinstance(config, ClassificationModelConfig)
            else regression_estimator(config)
        )
        model = FittedEstimator(native)
        model.fit(_finite_matrix(train, self._keys), target)
        self._estimator = model

    def predict_rows(self, frame: Frame) -> list[float]:
        """按冻结特征顺序返回有限回归值或原始数值类别。Args: frame。"""
        if self._estimator is None:
            raise OperatorError("模型还没有拟合或加载二进制产物")
        predicted = self._estimator.predict(_finite_matrix(frame, self._keys))
        if not self._is_classification:
            return predicted
        if any(
            not value.is_integer() or not 0 <= value < len(self._classes)
            for value in predicted
        ):
            raise OperatorError("分类产物的预测类别与冻结映射不一致")
        return [self._classes[int(value)] for value in predicted]

    def _scored(
        self, test: Frame, target: str, predicted: list[float]
    ) -> Frame:
        result = scored_frame(test, target, predicted)
        if not self._is_classification:
            return result
        probabilities = None
        if len(self._classes) == MIN_CLASSES and self._estimator is not None:
            probabilities = self._estimator.positive_probabilities(
                _finite_matrix(test, self._keys)
            )
        values = (
            probabilities
            if probabilities is not None
            else [None] * test.row_count
        )
        column = FrameColumn(
            key=SCORED_PROBA,
            name="正类概率（不可用时为空）",
            dtype=DTYPE_NUMBER,
            probability_classes=self._classes,
        )
        return replace(
            result,
            columns=(*result.columns, column),
            rows=tuple(
                (*row, probability)
                for row, probability in zip(result.rows, values, strict=True)
            ),
        )

    def report(self) -> tuple[ReportBlock, ...]:
        return () if self._seen is None else supervised_blocks(self._seen)

    def _run_details(
        self, train: Frame, truth: list[float], predicted: list[float]
    ) -> SupervisedRun:
        config = self._settings
        names = (
            CLASSIFICATION_LABELS
            if self._is_classification
            else REGRESSION_LABELS
        )
        return SupervisedRun(
            algorithm_name=names[config.algorithm],
            training_rows=train.row_count,
            feature_count=len(self._keys),
            truth=tuple(truth),
            predicted=tuple(predicted),
            is_classification=self._is_classification,
            should_standardize=config.should_standardize
            and config.algorithm in SCALED_ALGORITHMS,
            notices=() if self._estimator is None else self._estimator.notices,
            class_count=len(self._classes),
        )

    def trained_estimator(self) -> object | None:
        return None if self._estimator is None else self._estimator.estimator

    def dump_fitted(self) -> dict[str, Any] | None:
        return {
            "feature_keys": list(self._keys),
            "classes": list(self._classes),
            "algorithm": self._settings.algorithm,
        }

    def load_fitted(self, params: dict[str, Any]) -> None:
        """恢复特征与类别映射，模型本体随后单独加载。Args: params。"""
        self.validate_fitted(params)
        if params["algorithm"] != self._settings.algorithm:
            raise OperatorError("模型算法与冻结配置不一致")
        self._keys = tuple(cast(list[str], params["feature_keys"]))
        self._classes = tuple(
            float(value) for value in cast(list[float], params["classes"])
        )
        if (
            self._is_classification
            and not MIN_CLASSES <= len(self._classes) <= MAX_CLASSES
        ):
            raise OperatorError("分类模型缺少有效类别映射")
        if not self._is_classification and self._classes:
            raise OperatorError("回归模型不能包含分类映射")

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """校验不可重复的特征顺序和有限类别清单。Args: params。"""
        _validate_fitted(params)

    def attach_estimator(self, estimator: object) -> None:
        """核对算法、输入列数和类别编码后恢复本体。Args: estimator。"""
        config = self._settings
        expected = (
            classification_estimator(config)
            if isinstance(config, ClassificationModelConfig)
            else regression_estimator(config)
        )
        validate_adoption(
            estimator,
            expected,
            feature_count=len(self._keys),
            class_count=len(self._classes),
        )
        self._estimator = FittedEstimator(estimator)

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        del config, inputs
        keys = (
            (SCORED_TRUE, SCORED_PRED, SCORED_PROBA)
            if cls.MODEL_TASK == "classification"
            else (SCORED_TRUE, SCORED_PRED)
        )
        return {"scored": keys}


@register_operator
class RegressionModel(SupervisedModel):
    CODE = "regression_model"
    NAME = "通用回归模型"
    DESCRIPTION = (
        "18种常用回归；最多10万行128特征，核模型最多5000行，支持冻结后预测"
    )
    MODEL_TASK = "regression"
    CONFIG_MODEL = RegressionModelConfig


@register_operator
class ClassificationModel(SupervisedModel):
    CODE = "classification_model"
    NAME = "通用分类模型"
    DESCRIPTION = (
        "19种常用二分类与多分类，保留真实数值类别；仅真实二分类概率供ROC使用"
    )
    MODEL_TASK = "classification"
    CONFIG_MODEL = ClassificationModelConfig


def _target_values(frame: Frame, key: str) -> list[float]:
    values = numbers_of(frame, key)
    if any(value is None or not math.isfinite(value) for value in values):
        raise OperatorError(
            "目标列必须是完整的有限数值，请先处理缺失或非有限值"
        )
    return [float(value) for value in values if value is not None]


def _finite_matrix(frame: Frame, keys: tuple[str, ...]) -> list[list[float]]:
    rows = matrix_of(frame, keys)
    if not all(math.isfinite(value) for row in rows for value in row):
        raise OperatorError("特征中存在非有限数值，请先清理后重训或预测")
    return rows


def _check_budget(
    frame: Frame,
    keys: tuple[str, ...],
    config: RegressionModelConfig | ClassificationModelConfig,
) -> None:
    if not frame.rows or not keys:
        raise OperatorError("训练集需要至少一行和一个特征")
    limit = (
        MAX_KERNEL_ROWS
        if config.algorithm in {"svr", "svc"}
        else MAX_MLP_ROWS if config.algorithm == "mlp" else MAX_TRAIN_ROWS
    )
    if frame.row_count > limit or len(keys) > MAX_FEATURES:
        raise OperatorError(
            f"该模型最多训练 {limit} 行、128 个特征，请抽样或选择更适合的算法"
        )
    if config.algorithm == "knn" and config.n_neighbors > frame.row_count:
        raise OperatorError("近邻数量不能超过训练集行数")


def _validate_fitted(params: dict[str, Any]) -> None:
    keys: object = params.get("feature_keys")
    classes: object = params.get("classes")
    if not isinstance(keys, list) or not keys:
        raise OperatorError("模型缺少特征列序")
    entries = cast(list[object], keys)
    if len(entries) > MAX_FEATURES or any(
        not isinstance(key, str) or not key for key in entries
    ):
        raise OperatorError("特征列序必须是有界非空名称清单")
    if len(entries) != len(set(entries)):
        raise OperatorError("特征列序不能重复")
    if not isinstance(classes, list) or any(
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        for value in cast(list[object], classes)
    ):
        raise OperatorError("类别映射必须是有限数值清单")
    values = cast(list[float], classes)
    if values != sorted(set(values)) or len(values) > MAX_CLASSES:
        raise OperatorError("类别映射必须递增且不可重复")
    if not isinstance(params.get("algorithm"), str):
        raise OperatorError("模型缺少算法标识")
