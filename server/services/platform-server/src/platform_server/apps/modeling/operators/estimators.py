"""sklearn 边界 —— 无类型的第三方面全部收敛在此，出口只有本模块的包装类。

⚠ 收在一处不是洁癖：sklearn 的类型面是部分未知的，散着写会让每个算子文件都
挂上一串 `pyright: ignore`，而其中任何一条日后都可能盖住一个真的类型错误。
"""

import math
from collections.abc import Sequence
from typing import Any, Literal, cast

import numpy as np
from sklearn.decomposition import PCA
from sklearn.ensemble import (
    GradientBoostingRegressor,
    RandomForestRegressor,
)
from sklearn.linear_model import (
    LinearRegression,
    LogisticRegression,
    Ridge,
)

from platform_server.apps.modeling.operators.base import OperatorError

# 正则化方式。ridge 的惩罚只落在系数上，截距不参与
type Regularization = Literal["none", "ridge"]

# 逻辑回归只做两类
_BINARY_CLASSES = 2

# 树集成的两种。⚠ 两者的 `max_depth` 语义不同：森林里 None = 长到纯，
# 提升树里 None 不合法（它要浅树），所以那一档给一个明确的默认
type TreeKind = Literal["forest", "gbdt"]
_GBDT_DEPTH = 3
# 指数的安全上限。⚠ `math.exp(710)` 直接抛，而线性部分在特征没标准化时
# 轻易越过它——夹住比抛出去有用：概率本来就在 0 / 1 处饱和
_EXP_LIMIT = 700.0


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


class BinaryLogit:
    """二分类逻辑回归。

    ⚠ 只做**两类**：多分类的 sklearn 参数是每一类一行系数，拟合参数的形状、
    可服务表示与打分帧全都要跟着变形，那是另一个算子的事。类目多于两个时当场
    说清楚，不悄悄挑两个出来算。
    拟合参数仍是纯数（一组系数 + 一个截距 + 两个类目），因此走通道 A。
    """

    def __init__(self, *, use_intercept: bool, regularization_strength: float):
        self._use_intercept = use_intercept
        self._strength = regularization_strength
        self._coef: list[float] = []
        self._intercept = 0.0
        self._classes: list[float] = []

    def fit(
        self, rows: Sequence[Sequence[float]], target: Sequence[float]
    ) -> None:
        """在给定矩阵上拟合。类目不是两个时当场报错。

        Args: rows, target。
        """
        if not rows:
            raise OperatorError("训练集一行都没有，拟合不出模型")
        classes = sorted({float(value) for value in target})
        if len(classes) != _BINARY_CLASSES:
            raise OperatorError(
                f"逻辑回归只做两类，目标列上有 {len(classes)} 个不同取值。"
                "请先把它归成两类，或换一个分类算法"
            )
        self._classes = classes
        estimator = LogisticRegression(
            fit_intercept=self._use_intercept, C=self._strength
        )
        # pyright: ignore 的理由 —— 逻辑回归的 fit 在 sklearn 类型面上部分未知
        estimator.fit(  # pyright: ignore[reportUnknownMemberType]
            np.asarray(rows, dtype=float),
            np.asarray(target, dtype=float),
        )
        # pyright: ignore 的理由 —— coef_ / intercept_ 在类型面上部分未知
        raw_coef = cast(
            "Sequence[Sequence[float]]",
            estimator.coef_,  # pyright: ignore[reportUnknownMemberType]
        )
        raw_intercept = cast(
            "Sequence[float]",
            estimator.intercept_,  # pyright: ignore[reportUnknownMemberType]
        )
        flat = np.asarray(raw_coef, dtype=float).reshape(-1)
        self._coef, self._intercept = _flattened(
            [float(flat[index]) for index in range(flat.size)],
            float(np.asarray(raw_intercept, dtype=float).reshape(-1)[0]),
        )

    @property
    def coef(self) -> list[float]:
        """各特征的系数，与拟合时的列序一致。"""
        return list(self._coef)

    @property
    def intercept(self) -> float:
        """截距。"""
        return self._intercept

    @property
    def classes(self) -> list[float]:
        """两个类目，升序。下标 1 那个是「正类」。"""
        return list(self._classes)


def logistic_probability(
    coef: Sequence[float], intercept: float, row: Sequence[float]
) -> float:
    """一行落在正类上的概率。

    ⚠ 指数先夹到一个安全区间再算：`math.exp` 在 710 以上直接抛
    `OverflowError`，而线性部分在特征没标准化时轻易越过它。
    Args: coef, intercept, row。
    """
    linear = intercept + sum(
        weight * value for weight, value in zip(coef, row, strict=True)
    )
    clamped = min(max(linear, -_EXP_LIMIT), _EXP_LIMIT)
    return 1.0 / (1.0 + math.exp(-clamped))


class PrincipalComponents:
    """主成分：把若干列压成几条互不相关的轴。

    拟合参数是**中心点 + 一组基向量**，都是纯数，因此走通道 A。
    ⚠ 主成分对量纲极其敏感：没标准化时单位大的列会独占第一主成分。算子说明里
    要讲清楚，这里不替用户偷偷标准化——那会让「同一份数据两种结果」无从解释。
    """

    def __init__(self, *, n_components: int) -> None:
        self._n_components = n_components
        self._mean: list[float] = []
        self._components: list[list[float]] = []

    def fit(self, rows: Sequence[Sequence[float]]) -> None:
        """在给定矩阵上拟合。行数或列数不够时明说。

        Args: rows。
        """
        if not rows:
            raise OperatorError("训练集一行都没有，拟合不出主成分")
        width = len(rows[0])
        limit = min(len(rows), width)
        if self._n_components > limit:
            raise OperatorError(
                f"要 {self._n_components} 个主成分，而这份数据最多给得出 "
                f"{limit} 个（行数与列数的较小者）"
            )
        estimator = PCA(n_components=self._n_components)
        # pyright: ignore 的理由 —— 主成分的 fit 在 sklearn 类型面上部分未知
        estimator.fit(  # pyright: ignore[reportUnknownMemberType]
            np.asarray(rows, dtype=float)
        )
        # pyright: ignore 的理由 —— mean_ / components_ 在类型面上部分未知
        raw_mean = cast(
            "Sequence[float]",
            estimator.mean_,  # pyright: ignore[reportUnknownMemberType]
        )
        raw_axes = cast(
            "Sequence[Sequence[float]]",
            estimator.components_,  # pyright: ignore[reportUnknownMemberType]
        )
        mean = np.asarray(raw_mean, dtype=float).reshape(-1)
        axes = np.asarray(raw_axes, dtype=float)
        self._mean = [float(mean[index]) for index in range(mean.size)]
        self._components = [
            [float(axes[row][col]) for col in range(axes.shape[1])]
            for row in range(axes.shape[0])
        ]

    @property
    def mean(self) -> list[float]:
        """各列的中心点。"""
        return list(self._mean)

    @property
    def components(self) -> list[list[float]]:
        """每一条主成分轴上的权重，与拟合时的列序一致。"""
        return [list(row) for row in self._components]


def projected(
    mean: Sequence[float],
    components: Sequence[Sequence[float]],
    row: Sequence[float],
) -> list[float]:
    """把一行投到主成分轴上。

    Args: mean, components, row。
    """
    centered = [value - center for value, center in zip(row, mean, strict=True)]
    return [
        sum(
            weight * value for weight, value in zip(axis, centered, strict=True)
        )
        for axis in components
    ]


class TreeEnsemble:
    """树的集合：随机森林或梯度提升。

    ⚠ 拟合结果是**一堆对象**，纯 JSON 表达不出来——它走二进制通道
    （docs/MODELING_PLATFORM_DESIGN.md D9）。这个包装类只做两件事：把 sklearn
    的类型面收在这里，以及把估计器交出去封存。
    ⚠ `n_jobs` 定死 1：算子已经跑在单工进程池的子进程里，再让 sklearn 开一把
    线程会与同机别的消费循环抢核，而现象只是「偶尔整台机器一起变慢」。
    """

    def __init__(
        self,
        *,
        kind: TreeKind,
        n_estimators: int,
        max_depth: int | None,
        random_state: int,
    ) -> None:
        self._estimator = _tree_estimator(
            kind=kind,
            n_estimators=n_estimators,
            max_depth=max_depth,
            random_state=random_state,
        )
        self._feature_count = 0

    def fit(
        self, rows: Sequence[Sequence[float]], target: Sequence[float]
    ) -> None:
        """在给定矩阵上拟合。

        Args: rows, target。
        """
        if not rows:
            raise OperatorError("训练集一行都没有，拟合不出模型")
        self._feature_count = len(rows[0])
        # pyright: ignore 的理由 —— 集成模型的 fit 在 sklearn 类型面上部分未知
        self._estimator.fit(  # pyright: ignore[reportUnknownMemberType]
            np.asarray(rows, dtype=float),
            np.asarray(target, dtype=float),
        )

    def predict(self, rows: Sequence[Sequence[float]]) -> list[float]:
        """整批打分。

        ⚠ **一次调用算一批**：逐行调等于逐行付一次 Python → C 的往返，而那正是
        批量相位要省掉的东西（D11b）。
        Args: rows。
        """
        if not rows:
            return []
        if len(rows[0]) != self._feature_count:
            raise OperatorError(
                f"这个模型要 {self._feature_count} 列，"
                f"这里给了 {len(rows[0])} 列"
            )
        # pyright: ignore 的理由 —— predict 的返回在类型面上部分未知
        raw = cast(
            "Sequence[float]",
            self._estimator.predict(  # pyright: ignore[reportUnknownMemberType]
                np.asarray(rows, dtype=float)
            ),
        )
        flat = np.asarray(raw, dtype=float).reshape(-1)
        return [float(flat[index]) for index in range(flat.size)]

    def adopt(self, estimator: object, *, feature_count: int) -> None:
        """装上一个从产物里加载回来的估计器。

        ⚠ 只认「有 predict 的东西」，且把列数一并记下来：产物自己不记列名，
        投影按位置取——列数对不上时预测照样算得出来，只是每一列都错位了。
        Args: estimator, feature_count。
        """
        if not callable(getattr(estimator, "predict", None)):
            raise OperatorError("产物里那个东西不是一个能预测的模型")
        self._estimator = cast("Any", estimator)
        self._feature_count = feature_count

    @property
    def estimator(self) -> object:
        """交出去封存的那个对象。"""
        return self._estimator

    @property
    def importances(self) -> list[float]:
        """树自己给的特征重要性，与拟合时的列序一致。"""
        # pyright: ignore 的理由 —— feature_importances_ 在类型面上部分未知
        raw = cast(
            "Sequence[float]",
            self._estimator.feature_importances_,  # pyright: ignore[reportUnknownMemberType]
        )
        flat = np.asarray(raw, dtype=float).reshape(-1)
        return [float(flat[index]) for index in range(flat.size)]


def _tree_estimator(
    *,
    kind: TreeKind,
    n_estimators: int,
    max_depth: int | None,
    random_state: int,
) -> Any:
    """按种类造一个集成估计器。

    Args: kind, n_estimators, max_depth, random_state。
    """
    if kind == "gbdt":
        return GradientBoostingRegressor(
            n_estimators=n_estimators,
            max_depth=max_depth or _GBDT_DEPTH,
            random_state=random_state,
        )
    return RandomForestRegressor(
        n_estimators=n_estimators,
        max_depth=max_depth,
        random_state=random_state,
        n_jobs=1,
    )
