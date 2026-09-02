"""sklearn 边界 —— 无类型的第三方面全部收敛在此，出口只有本模块的包装类。

⚠ 收在一处不是洁癖：sklearn 的类型面是部分未知的，散着写会让每个算子文件都
挂上一串 `pyright: ignore`，而其中任何一条日后都可能盖住一个真的类型错误。
"""

from collections.abc import Sequence
from typing import Literal, cast

import numpy as np
from sklearn.linear_model import LinearRegression, Ridge

from platform_server.apps.modeling.operators.base import OperatorError

# 正则化方式。ridge 的惩罚只落在系数上，截距不参与
type Regularization = Literal["none", "ridge"]


class LeastSquares:
    """线性回归，可选岭惩罚。

    拟合参数是纯数，因此可以纯 JSON 表达、直接上线（设计文档 D9）。
    """

    def __init__(
        self,
        *,
        use_intercept: bool,
        regularization: Regularization = "none",
        ridge_alpha: float = 0.0,
    ) -> None:
        self._use_intercept = use_intercept
        self._regularization = regularization
        self._ridge_alpha = ridge_alpha
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
        if self._regularization == "ridge":
            self._coef, self._intercept = _ridge_solution(
                rows,
                target,
                use_intercept=self._use_intercept,
                alpha=self._ridge_alpha,
            )
            return
        self._coef, self._intercept = _ordinary_solution(
            rows, target, use_intercept=self._use_intercept
        )

    @property
    def coef(self) -> list[float]:
        """各特征的系数，与拟合时的列序一致。"""
        return list(self._coef)

    @property
    def intercept(self) -> float:
        """截距。"""
        return self._intercept


def _ordinary_solution(
    rows: Sequence[Sequence[float]],
    target: Sequence[float],
    *,
    use_intercept: bool,
) -> tuple[list[float], float]:
    """普通最小二乘的系数与截距。

    Args: rows, target, use_intercept。
    """
    # ⚠ `fit_intercept` 是 sklearn 定死的形参名，改名即 TypeError；本仓自己
    # 那一侧叫 `use_intercept`（命名闸要 use_/is_ 这类前缀）
    estimator = LinearRegression(fit_intercept=use_intercept)
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
    return _flattened(raw_coef, raw_intercept)


def _ridge_solution(
    rows: Sequence[Sequence[float]],
    target: Sequence[float],
    *,
    use_intercept: bool,
    alpha: float,
) -> tuple[list[float], float]:
    """岭回归的系数与截距：解 (XᵀX + αI)β = Xᵀy。

    ⚠ 截距不参与惩罚——拟合截距时 sklearn 先把 X 与 y 中心化，α 因而只压系数；
    自己给原始 X 加 αI 会连截距一起罚，整条线被拉向原点。
    Args: rows, target, use_intercept, alpha。
    """
    estimator = Ridge(alpha=alpha, fit_intercept=use_intercept)
    # pyright: ignore 的理由 —— 岭回归的 fit 在 sklearn 类型面上部分未知
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
    return _flattened(raw_coef, raw_intercept)


def _flattened(
    raw_coef: Sequence[float], raw_intercept: float
) -> tuple[list[float], float]:
    """把估计器给的系数摊平成一串纯数。

    Args: raw_coef, raw_intercept。
    """
    flat = np.asarray(raw_coef, dtype=float).reshape(-1)
    return (
        [float(flat[index]) for index in range(flat.size)],
        float(raw_intercept),
    )
