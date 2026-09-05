"""sklearn 边界 —— 无类型的第三方面全部收敛在此，出口只有本模块的包装类。

⚠ 收在一处不是洁癖：sklearn 的类型面是部分未知的，散着写会让每个算子文件都
挂上一串 `pyright: ignore`，而其中任何一条日后都可能盖住一个真的类型错误。
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
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
        self._n_iter: int | None = None
        self._max_iter = 0

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
        self._n_iter = _rounds_of(estimator)
        self._max_iter = int(estimator.max_iter)

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

    @property
    def n_iter(self) -> int | None:
        """实际迭代了多少轮；None = 还没拟合过。

        ⚠ 撞上 `max_iter` 就是没收敛，那组系数不可信——而模型照样打得出分，
        指标看着也正常，不把这个数交出去的话界面上一个字都看不见。
        """
        return self._n_iter

    @property
    def max_iter(self) -> int:
        """迭代上限。⚠ 名字随 sklearn，它是从估计器身上读回来的默认值。"""
        return self._max_iter


def _rounds_of(estimator: LogisticRegression) -> int | None:
    """估计器实际迭代了多少轮；读不出来给 `None` 不给 0。

    Args: estimator。
    """
    # pyright: ignore 的理由 —— n_iter_ 在 sklearn 类型面上部分未知
    raw = cast(
        "Sequence[int]",
        estimator.n_iter_,  # pyright: ignore[reportUnknownMemberType]
    )
    flat = np.asarray(raw, dtype=int).reshape(-1)
    return int(flat[0]) if flat.size else None


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
        self._explained: list[float] = []

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
        # pyright: ignore 的理由 —— explained_variance_ratio_ 在类型面上部分未知
        raw_ratio = cast(
            "Sequence[float]",
            estimator.explained_variance_ratio_,  # pyright: ignore[reportUnknownMemberType]
        )
        mean = np.asarray(raw_mean, dtype=float).reshape(-1)
        axes = np.asarray(raw_axes, dtype=float)
        ratio = np.asarray(raw_ratio, dtype=float).reshape(-1)
        self._mean = [float(mean[index]) for index in range(mean.size)]
        self._components = [
            [float(axes[row][col]) for col in range(axes.shape[1])]
            for row in range(axes.shape[0])
        ]
        self._explained = [float(ratio[seat]) for seat in range(ratio.size)]

    @property
    def mean(self) -> list[float]:
        """各列的中心点。"""
        return list(self._mean)

    @property
    def components(self) -> list[list[float]]:
        """每一条主成分轴上的权重，与拟合时的列序一致。"""
        return [list(row) for row in self._components]

    @property
    def explained(self) -> list[float]:
        """每条轴解释掉原始方差的比例，与 `components` 同序。

        ⚠ 只有拟合那一趟拿得到：sklearn 算完就有，回灌参数上线的那一路没有它，
        那时是空清单。不交出去的话，用户看到的 pc1…pcK 就是几列没头没尾的数。
        """
        return list(self._explained)


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


@dataclass(frozen=True)
class EnsembleShape:
    """一片树集成的形状。⚠ 一棵树都没有时深度与叶子数是 `None` 不是 0。"""

    count: int
    depth: int | None
    leaves: int | None


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

    @property
    def shape(self) -> EnsembleShape:
        """这片集成长成什么样：几棵、最深几层、一共多少个叶子。

        ⚠ 三个数一起交出去而不是各读各的：树在训练区间之外恒给边界叶值，
        「深到什么程度、碎成多少块」是判断这个模型敢不敢用的唯一依据，而它
        一个字都不在纯 JSON 的拟合参数里（通道 B）。
        """
        members = _member_trees(self._estimator)
        if not members:
            return EnsembleShape(count=0, depth=None, leaves=None)
        return EnsembleShape(
            count=len(members),
            depth=max(int(item.max_depth) for item in members),
            leaves=sum(int(item.n_leaves) for item in members),
        )


def _member_trees(estimator: object) -> list[Any]:
    """集成里每棵树的内部结构，摊平成一串。

    ⚠ 两族的形状不同：森林的 `estimators_` 是一串树，提升树的是每轮一排。
    Args: estimator。
    """
    members: Any | None = getattr(estimator, "estimators_", None)
    if members is None:
        return []
    flat: Any = np.asarray(members, dtype=object).reshape(-1)
    made: list[Any] = []
    for item in flat:
        inner: Any | None = getattr(item, "tree_", None)
        if inner is not None:
            made.append(inner)
    return made


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
