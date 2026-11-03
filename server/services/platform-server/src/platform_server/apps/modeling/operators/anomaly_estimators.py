"""可封存的原生异常估计器与分数边界。"""

from collections.abc import Mapping
from types import MappingProxyType
from typing import Protocol, cast

import numpy as np
from numpy.typing import NDArray
from sklearn.covariance import EllipticEnvelope
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.svm import OneClassSVM

from platform_server.apps.modeling.operators.base import OperatorError
from platform_server.apps.modeling.operators.unsupervised_config import (
    AnomalyModelConfig,
)
from platform_server.apps.modeling.operators.unsupervised_data import Matrix
from platform_server.apps.modeling.operators.unsupervised_native import (
    configured,
)

MAX_FOREST_SAMPLE_NODES = 100000

ANOMALY_ROW_LIMITS: Mapping[str, int] = MappingProxyType(
    {
        "isolation_forest": 50000,
        "local_outlier_factor": 10000,
        "one_class_svm": 5000,
        "elliptic_envelope": 5000,
    }
)


class _AnomalyEstimator(Protocol):
    def fit(self, rows: Matrix) -> object: ...
    def score_samples(self, rows: Matrix) -> NDArray[np.float64]: ...


def create_anomaly(config: AnomalyModelConfig, rows: Matrix) -> object:
    """只创建可对新样本打分的原生估计器；Args: config, rows。"""
    if config.algorithm == "isolation_forest":
        samples = min(config.max_samples, len(rows))
        if samples * config.n_estimators > MAX_FOREST_SAMPLE_NODES:
            raise OperatorError(
                "树数与每树样本数乘积不能超过100000，请减小模型"
            )
        return configured(
            IsolationForest(
                n_estimators=config.n_estimators,
                contamination="auto",
                random_state=config.random_state,
                n_jobs=1,
            ),
            max_samples=samples,
        )
    if config.algorithm == "local_outlier_factor":
        if config.n_neighbors >= len(rows):
            raise OperatorError("局部邻居数必须小于正常拟合段行数")
        return LocalOutlierFactor(
            n_neighbors=config.n_neighbors,
            novelty=True,
            contamination="auto",
            n_jobs=1,
        )
    if config.algorithm == "one_class_svm":
        gamma = (
            config.gamma if config.gamma_mode == "fixed" else config.gamma_mode
        )
        return configured(
            OneClassSVM(
                kernel=config.kernel,
                nu=config.nu,
                max_iter=config.max_iter,
                cache_size=64,
            ),
            gamma=gamma,
        )
    return _elliptic(config, rows)


def _elliptic(config: AnomalyModelConfig, rows: Matrix) -> object:
    if (
        len(rows) <= rows.shape[1] ** 2
        or np.linalg.matrix_rank(rows - np.mean(rows, axis=0)) < rows.shape[1]
    ):
        raise OperatorError(
            "椭圆包络需要多于特征数平方的正常拟合样本，且特征不能常量或共线"
        )
    support = (
        config.support_fraction
        if config.support_fraction_mode == "fixed"
        else None
    )
    return EllipticEnvelope(
        contamination=0.1,
        support_fraction=support,
        random_state=config.random_state,
    )


def fit_anomaly(estimator: object, rows: Matrix) -> None:
    cast(_AnomalyEstimator, estimator).fit(rows)
    if int(getattr(estimator, "fit_status_", 0)) != 0:
        raise OperatorError(
            "单类SVM尚未收敛，请调整参数、增大迭代次数或缩小训练范围"
        )


def abnormality(estimator: object, rows: Matrix) -> Matrix:
    scores = -np.asarray(
        cast(_AnomalyEstimator, estimator).score_samples(rows), dtype=np.float64
    )
    if scores.shape != (len(rows),) or not np.isfinite(scores).all():
        raise OperatorError("异常算法没有产生逐行的有限分数，无法判断")
    return scores


def validate_anomaly_estimator(
    estimator: object, algorithm: str, features: int
) -> None:
    classes = {
        "isolation_forest": IsolationForest,
        "local_outlier_factor": LocalOutlierFactor,
        "one_class_svm": OneClassSVM,
        "elliptic_envelope": EllipticEnvelope,
    }
    if not isinstance(estimator, classes[algorithm]):
        raise OperatorError("异常模型产物与发布算法不一致")
    if int(getattr(estimator, "n_features_in_", -1)) != features:
        raise OperatorError("异常模型产物的特征数量与冻结参数不一致")
    if isinstance(estimator, LocalOutlierFactor) and not estimator.novelty:
        raise OperatorError("局部离群模型必须使用支持新样本的novelty模式")
