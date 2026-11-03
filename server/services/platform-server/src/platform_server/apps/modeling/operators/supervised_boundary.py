"""收敛 sklearn 的类型面，核对预测形状和数值并保留训练告警。"""

import math
import warnings
from collections.abc import Mapping, Sequence
from typing import Protocol, SupportsInt, cast

import numpy as np
from numpy.typing import NDArray
from sklearn.exceptions import ConvergenceWarning
from threadpoolctl import threadpool_limits

from platform_server.apps.modeling.operators.base import OperatorError


class _Estimator(Protocol):
    def fit(
        self, rows: NDArray[np.float64], target: NDArray[np.float64]
    ) -> object: ...
    def predict(self, rows: NDArray[np.float64]) -> object: ...


class FittedEstimator:
    """只持有原生估计器，包装自身不进入序列化产物。"""

    def __init__(self, estimator: object) -> None:
        if not callable(getattr(estimator, "predict", None)):
            raise OperatorError("产物不是可预测的监督模型")
        self.estimator = estimator
        self._typed = cast(_Estimator, estimator)
        self.notices: tuple[str, ...] = ()

    def fit(
        self, rows: Sequence[Sequence[float]], target: Sequence[float]
    ) -> None:
        """仅使用训练集拟合并收集有界告警。Args: rows, target。"""
        try:
            with (
                warnings.catch_warnings(record=True) as captured,
                threadpool_limits(limits=1),
            ):
                warnings.simplefilter("always", ConvergenceWarning)
                self._typed.fit(
                    np.asarray(rows, dtype=float),
                    np.asarray(target, dtype=float),
                )
            self.notices = tuple(
                dict.fromkeys(_notice(item.category) for item in captured)
            )[:8]
        except (ValueError, ArithmeticError, TypeError) as error:
            raise OperatorError(
                "模型拟合失败，请检查样本数量、类别分布、特征范围与算法参数"
            ) from error

    def predict(self, rows: Sequence[Sequence[float]]) -> list[float]:
        """返回每行一个有限预测值。Args: rows。"""
        if not rows:
            return []
        try:
            with threadpool_limits(limits=1):
                raw = self._typed.predict(np.asarray(rows, dtype=float))
            array = np.asarray(cast(Sequence[float], raw), dtype=float)
        except (ValueError, ArithmeticError, TypeError) as error:
            raise OperatorError(
                "模型无法计算这批特征，请核对输入形状和有效范围"
            ) from error
        if array.shape == (len(rows), 1):
            array = array.reshape(-1)
        if array.ndim != 1 or array.size != len(rows):
            raise OperatorError("模型预测结果与输入行数不一致")
        result = [float(item) for item in array]
        if not all(math.isfinite(item) for item in result):
            raise OperatorError(
                "模型产生非有限预测值，请检查输入范围或重新训练"
            )
        return result

    def positive_probabilities(
        self, rows: Sequence[Sequence[float]]
    ) -> list[float] | None:
        """只接受估计器真实提供的两类概率。Args: rows。"""
        method: object = getattr(self.estimator, "predict_proba", None)
        if not callable(method):
            return None
        if not rows:
            return []
        try:
            with threadpool_limits(limits=1):
                values: object = method(np.asarray(rows, dtype=float))
            array = np.asarray(
                cast(Sequence[Sequence[float]], values), dtype=float
            )
        except (ValueError, ArithmeticError, TypeError) as error:
            raise OperatorError(
                "模型无法产生有效分类概率，请检查输入范围"
            ) from error
        if array.shape != (len(rows), 2):
            raise OperatorError("模型概率结果与二分类契约不一致")
        result = [float(row[1]) for row in array]
        if not all(math.isfinite(item) and 0 <= item <= 1 for item in result):
            raise OperatorError("模型产生无效概率，请检查数值范围或重新训练")
        return result


def _notice(category: type[Warning]) -> str:
    if issubclass(category, ConvergenceWarning):
        return "训练未满足收敛条件；请增加迭代、调整尺度或更换参数后重训"
    return "训练出现样本条件提示；请检查共线性、类别样本量与特征范围"


def validate_adoption(
    estimator: object, expected: object, *, feature_count: int, class_count: int
) -> None:
    """核对产物契约；Args: estimator, expected, feature_count, class_count。"""
    if not isinstance(estimator, type(expected)) or not isinstance(
        _native(estimator), type(_native(expected))
    ):
        raise OperatorError("二进制产物的算法类型与冻结配置不一致")
    columns = _feature_count(estimator)
    if (
        not isinstance(columns, (int, np.integer))
        or int(cast(SupportsInt, columns)) != feature_count
    ):
        raise OperatorError("二进制产物的特征数量与冻结列序不一致")
    if class_count:
        raw: object = getattr(estimator, "classes_", None)
        classes = np.asarray(cast(Sequence[float], raw), dtype=float)
        if classes.ndim != 1 or classes.tolist() != list(range(class_count)):
            raise OperatorError("分类产物的类别编码与冻结映射不一致")


def _native(estimator: object) -> object:
    steps: object = getattr(estimator, "named_steps", None)
    return (
        cast(Mapping[str, object], steps).get("model")
        if isinstance(steps, Mapping)
        else estimator
    )


def _feature_count(estimator: object) -> object:
    if type(estimator).__module__.split(".", maxsplit=1)[0] == "catboost":
        # ⚠ CatBoost 1.2.10 回放后列数为 0，本体列名仍完整。
        names: object = getattr(estimator, "feature_names_", None)
        if isinstance(names, list):
            return len(cast(list[object], names))
    return getattr(estimator, "n_features_in_", None)
