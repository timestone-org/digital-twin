"""sklearn 边界 —— 无类型的第三方面全部收敛在此，出口只有本模块的协议类型。

超参钉死在代码里（ADR-0007）：几百条样本配大树必然过拟合，树浅、叶大、带
L2 是安全侧的取法；调参不是运营操作。
"""

from collections.abc import Sequence
from typing import Protocol, cast

from sklearn import __version__ as _installed_sklearn_version
from sklearn.ensemble import HistGradientBoostingRegressor


class Estimator(Protocol):
    """训练与预测的最小面。实现是 HGBR，测试可用假件。"""

    def fit(
        self,
        features: Sequence[Sequence[float]],
        targets: Sequence[float],
        sample_weight: Sequence[float],
    ) -> object: ...

    def predict(
        self, features: Sequence[Sequence[float]]
    ) -> Sequence[float]: ...


def make_quantile_estimator(quantile: float) -> Estimator:
    """一条分位数的梯度提升估计器。原生吃 NaN，缺测特征不必填充。

    Args: quantile（0~1）。
    """
    return cast(
        Estimator,
        HistGradientBoostingRegressor(
            loss="quantile",
            quantile=quantile,
            learning_rate=0.05,
            max_iter=300,
            max_leaf_nodes=15,
            min_samples_leaf=5,
            l2_regularization=1.0,
            random_state=0,
        ),
    )


def sklearn_version() -> str:
    """当前安装的 sklearn 版本，写进工件供加载时比对。"""
    return _installed_sklearn_version
