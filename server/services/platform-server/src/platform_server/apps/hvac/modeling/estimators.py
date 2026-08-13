"""sklearn 边界 —— 无类型的第三方面全部收敛在此，出口只有本模块的包装类。

两段混合模型（docs/AC_MODEL_DESIGN.md §2.1）：分类器答「会不会瞬时达标」，
回归森林只在非零样本上答「不瞬时的话要多久」。超参钉死在代码里（ADR-0007）。
⚠ 随机森林自 sklearn 1.4 起原生吃 NaN，缺测特征不必填充。
"""

from collections.abc import Sequence
from typing import cast

import numpy as np
from sklearn import __version__ as _installed_sklearn_version
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor

# 树的数量与叶子下限：几百到上万样本的量级，300 棵足够稳，叶子 5 防背样本
_TREES = 300
_MIN_LEAF = 5


class ZeroClassifier:
    """阶段 A：这次开机会不会「一开机就已达标」（时长 0）。"""

    def __init__(self) -> None:
        self._forest = RandomForestClassifier(
            n_estimators=_TREES,
            min_samples_leaf=_MIN_LEAF,
            random_state=0,
            n_jobs=1,
        )
        self._only_class: bool | None = None

    def fit(
        self,
        rows: Sequence[Sequence[float]],
        is_zero: Sequence[bool],
        sample_weight: Sequence[float],
    ) -> None:
        """拟合。⚠ 训练集里只有一类时森林给不出另一类的概率，退化成常量。

        Args: rows, is_zero, sample_weight。
        """
        found = set(is_zero)
        if len(found) == 1:
            self._only_class = found.pop()
            return
        # pyright: ignore 的理由 —— 随机森林的 fit 在 sklearn 类型面上是部分未知
        self._forest.fit(  # pyright: ignore[reportUnknownMemberType]
            np.asarray(rows, dtype=float),
            np.asarray(is_zero),
            sample_weight=np.asarray(sample_weight, dtype=float),
        )

    def proba_zero(self, row: Sequence[float]) -> float:
        """这一行「瞬时达标」的概率。

        Args: row。
        """
        if self._only_class is not None:
            return 1.0 if self._only_class else 0.0
        # pyright: ignore 的理由 —— classes_/predict_proba 在类型面上部分未知
        classes = cast(
            list[bool],
            self._forest.classes_.tolist(),  # pyright: ignore[reportUnknownMemberType, reportAttributeAccessIssue]
        )
        at = classes.index(True)
        proba = cast(
            "np.ndarray[tuple[int, int], np.dtype[np.float64]]",
            self._forest.predict_proba(  # pyright: ignore[reportUnknownMemberType]
                np.asarray([row], dtype=float)
            ),
        )
        return float(proba[0][at])


class DurationForest:
    """阶段 B：不瞬时达标时要多久。区间取树间预测的分位。

    ⚠ 树间分位是实用近似不是完整的分位数回归森林：它量的是模型的不确定，
    偏窄时靠覆盖率指标暴露（页面标出来），不靠假装它是完整区间。
    """

    def __init__(self) -> None:
        self._forest = RandomForestRegressor(
            n_estimators=_TREES,
            min_samples_leaf=_MIN_LEAF,
            random_state=0,
            n_jobs=1,
        )

    def fit(
        self,
        rows: Sequence[Sequence[float]],
        minutes: Sequence[float],
        sample_weight: Sequence[float],
    ) -> None:
        """拟合非零时长。

        Args: rows, minutes, sample_weight。
        """
        # pyright: ignore 的理由 —— 随机森林的 fit 在 sklearn 类型面上是部分未知
        self._forest.fit(  # pyright: ignore[reportUnknownMemberType]
            np.asarray(rows, dtype=float),
            np.asarray(minutes, dtype=float),
            sample_weight=np.asarray(sample_weight, dtype=float),
        )

    def quantiles_at(
        self, row: Sequence[float], levels: Sequence[float]
    ) -> list[float]:
        """一行在若干分位水平上的条件时长。

        Args: row, levels（0~1，升序）。
        """
        batch = np.asarray([row], dtype=float)
        estimators = cast(
            list[RandomForestRegressor],
            self._forest.estimators_,  # pyright: ignore[reportUnknownMemberType]
        )
        spread = np.asarray(
            [_first_prediction(tree, batch) for tree in estimators],
            dtype=float,
        )
        return [float(np.percentile(spread, level * 100)) for level in levels]


def _first_prediction(
    tree: RandomForestRegressor,
    batch: "np.ndarray[tuple[int, int], np.dtype[np.float64]]",
) -> float:
    """一棵树对单行的预测值。

    Args: tree, batch（单行）。
    """
    # pyright: ignore 的理由 —— 树的 predict 在 sklearn 类型面上部分未知；
    # Unknown 立即在 float() 处收敛，不外溢
    predicted = cast(
        "np.ndarray[tuple[int], np.dtype[np.float64]]",
        tree.predict(batch),  # pyright: ignore[reportUnknownMemberType]
    )
    return float(predicted[0])


def sklearn_version() -> str:
    """当前安装的 sklearn 版本，写进工件供加载时比对。"""
    return _installed_sklearn_version
