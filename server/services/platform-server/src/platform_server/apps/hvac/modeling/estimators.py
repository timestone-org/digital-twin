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


# 早停只在样本够多时开：小折的验证集只有几行，会在噪声上过早停车
_EARLY_STOPPING_MIN_ROWS = 1000


def make_quantile_estimator(quantile: float, *, row_count: int) -> Estimator:
    """一条分位数的梯度提升估计器。原生吃 NaN，缺测特征不必填充。

    ⚠ 实测（Apple Silicon）：2000×22 一次分位拟合约 3s，10k 样本 × 18 次
    拟合按 300 迭代算要十几分钟——真实房间全史上万条可用事件，超参必须按
    这个规模定，否则每次训练都撞超时。迭代减半用学习率补偿，大样本再靠
    早停砍掉后半段没有增益的迭代。
    Args: quantile（0~1）, row_count（这次拟合的训练行数）。
    """
    return cast(
        Estimator,
        HistGradientBoostingRegressor(
            loss="quantile",
            quantile=quantile,
            learning_rate=0.1,
            max_iter=150,
            max_leaf_nodes=15,
            min_samples_leaf=5,
            l2_regularization=1.0,
            # sklearn 的类型面把 early_stopping 标成 str，实际收 bool：收敛在边界
            early_stopping=cast(str, row_count >= _EARLY_STOPPING_MIN_ROWS),
            validation_fraction=0.1,
            n_iter_no_change=10,
            random_state=0,
        ),
    )


def sklearn_version() -> str:
    """当前安装的 sklearn 版本，写进工件供加载时比对。"""
    return _installed_sklearn_version
