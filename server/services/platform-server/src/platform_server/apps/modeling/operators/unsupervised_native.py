"""收敛第三方动态参数与科学计算函数的类型边界。"""

from typing import Any, Protocol, cast

from sklearn import cluster, metrics

from platform_server.apps.modeling.operators.unsupervised_data import Matrix


class _Parameters(Protocol):
    def set_params(self, **parameters: object) -> object: ...


class _Bandwidth(Protocol):
    def __call__(
        self,
        rows: Matrix,
        *,
        quantile: float,
        n_samples: int,
        random_state: int,
        n_jobs: int,
    ) -> float: ...


class _Silhouette(Protocol):
    def __call__(
        self, rows: Matrix, labels: list[int], *, metric: str
    ) -> float: ...


def configured(estimator: object, **parameters: object) -> object:
    return cast(_Parameters, estimator).set_params(**parameters)


def bandwidth(rows: Matrix, quantile: float, size: int, seed: int) -> float:
    native: Any = cluster
    function = cast(_Bandwidth, native.estimate_bandwidth)
    return function(
        rows, quantile=quantile, n_samples=size, random_state=seed, n_jobs=1
    )


def silhouette(rows: Matrix, labels: list[int], metric: str) -> float:
    native: Any = metrics
    function = cast(_Silhouette, native.silhouette_score)
    return function(rows, labels, metric=metric)
