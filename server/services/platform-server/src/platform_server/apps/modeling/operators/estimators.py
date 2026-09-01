"""sklearn 边界 —— 无类型的第三方面全部收敛在此，出口只有本模块的包装类。

⚠ 收在一处不是洁癖：sklearn 的类型面是部分未知的，散着写会让每个算子文件都
挂上一串 `pyright: ignore`，而其中任何一条日后都可能盖住一个真的类型错误。
"""

from collections.abc import Sequence
from typing import cast

import numpy as np
from sklearn.linear_model import LinearRegression

from platform_server.apps.modeling.operators.base import OperatorError


class LeastSquares:
    """最小二乘线性回归。

    拟合参数是纯数，因此可以纯 JSON 表达、直接上线（设计文档 D9）。
    """

    def __init__(self, *, use_intercept: bool) -> None:
        self._use_intercept = use_intercept
        self._coef: list[float] = []
        self._intercept = 0.0

    def fit(
        self, rows: Sequence[Sequence[float]], target: Sequence[float]
    ) -> None:
        """在给定矩阵上拟合。行数不足以定出参数时明说，不给一组假系数。

        Args: rows, target。
        """
        if not rows:
            raise OperatorError("训练集一行都没有，拟合不出模型")
        # ⚠ `fit_intercept` 是 sklearn 定死的形参名，改名即 TypeError；本仓自己
        # 那一侧叫 `use_intercept`（命名闸要 use_/is_ 这类前缀）
        estimator = LinearRegression(fit_intercept=self._use_intercept)
        # pyright: ignore 的理由 —— 线性回归的 fit 在 sklearn 类型面上部分未知
        estimator.fit(  # pyright: ignore[reportUnknownMemberType]
            np.asarray(rows, dtype=float),
            np.asarray(target, dtype=float),
        )
        # pyright: ignore 的理由 —— coef_ / intercept_ 在类型面上部分未知
        raw_coef = cast(
            "Sequence[float]",
            estimator.coef_,  # pyright: ignore[reportUnknownMemberType]
        )
        raw_intercept = cast(
            "float",
            estimator.intercept_,  # pyright: ignore[reportUnknownMemberType]
        )
        flat = np.asarray(raw_coef, dtype=float).reshape(-1)
        self._coef = [float(flat[index]) for index in range(flat.size)]
        self._intercept = float(raw_intercept)

    @property
    def coef(self) -> list[float]:
        """各特征的系数，与拟合时的列序一致。"""
        return list(self._coef)

    @property
    def intercept(self) -> float:
        """截距。"""
        return self._intercept
