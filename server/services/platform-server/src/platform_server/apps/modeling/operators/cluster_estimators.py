"""聚类估计器边界，原生对象不跨越算子执行边界。"""

from collections.abc import Mapping
from types import MappingProxyType
from typing import Protocol, cast

import numpy as np
from numpy.typing import NDArray
from sklearn.cluster import (
    DBSCAN,
    AgglomerativeClustering,
    Birch,
    KMeans,
    MeanShift,
    MiniBatchKMeans,
    SpectralClustering,
)
from sklearn.mixture import GaussianMixture

from platform_server.apps.modeling.operators.base import OperatorError
from platform_server.apps.modeling.operators.unsupervised_config import (
    ClusteringConfig,
)
from platform_server.apps.modeling.operators.unsupervised_data import Matrix
from platform_server.apps.modeling.operators.unsupervised_native import (
    bandwidth,
    configured,
)

CLUSTER_ROW_LIMITS: Mapping[str, int] = MappingProxyType(
    {
        "kmeans": 50000,
        "minibatch_kmeans": 100000,
        "gaussian_mixture": 30000,
        "dbscan": 4000,
        "agglomerative": 3000,
        "birch": 100000,
        "mean_shift": 3000,
        "spectral": 1500,
    }
)


class _ClusterEstimator(Protocol):
    def fit_predict(self, rows: Matrix) -> NDArray[np.int64]: ...


def create_cluster(config: ClusteringConfig, rows: Matrix) -> object:
    """按白名单构造有界估计器；Args: config, rows。"""
    count = config.n_clusters
    if config.algorithm == "kmeans":
        return configured(
            KMeans(
                n_clusters=count,
                max_iter=config.max_iter,
                random_state=config.random_state,
            ),
            n_init=10,
        )
    if config.algorithm == "minibatch_kmeans":
        return configured(
            MiniBatchKMeans(
                n_clusters=count,
                max_iter=config.max_iter,
                batch_size=config.batch_size,
                random_state=config.random_state,
            ),
            n_init=3,
        )
    if config.algorithm == "gaussian_mixture":
        return GaussianMixture(
            n_components=count,
            covariance_type=config.covariance_type,
            reg_covar=config.reg_covar,
            max_iter=config.max_iter,
            n_init=1,
            random_state=config.random_state,
        )
    return _geometric_cluster(config, rows)


def _geometric_cluster(config: ClusteringConfig, rows: Matrix) -> object:
    count = config.n_clusters
    if config.algorithm == "dbscan":
        return DBSCAN(eps=config.eps, min_samples=config.min_samples, n_jobs=1)
    if config.algorithm == "agglomerative":
        return AgglomerativeClustering(
            n_clusters=count,
            linkage=config.linkage,
            metric="euclidean" if config.linkage == "ward" else config.metric,
        )
    if config.algorithm == "birch":
        return Birch(
            n_clusters=count,
            threshold=config.birch_threshold,
            branching_factor=config.branching_factor,
        )
    if config.algorithm == "mean_shift":
        return MeanShift(
            bandwidth=_bandwidth(config, rows),
            max_iter=config.max_iter,
            n_jobs=1,
        )
    return SpectralClustering(
        n_clusters=count,
        affinity=config.affinity,
        gamma=config.gamma,
        n_neighbors=min(config.n_neighbors, len(rows) - 1),
        random_state=config.random_state,
        n_init=10,
        assign_labels="kmeans",
        n_jobs=1,
    )


def cluster_labels(estimator: object, rows: Matrix) -> list[int]:
    """将无类型第三方结果立即收敛为整数标签；Args: estimator, rows。"""
    labels = cast(_ClusterEstimator, estimator).fit_predict(rows)
    result = [int(value) for value in labels]
    if len(result) != len(rows):
        raise OperatorError("聚类算法未返回每一行的标签")
    return result


def _bandwidth(config: ClusteringConfig, rows: Matrix) -> float:
    if config.bandwidth_mode == "fixed":
        return config.bandwidth
    result = float(
        bandwidth(
            rows,
            config.bandwidth_quantile,
            min(500, len(rows)),
            config.random_state,
        )
    )
    if not np.isfinite(result) or result <= 0:
        raise OperatorError("自动估计带宽为零或无效，请指定正的固定带宽")
    return result
