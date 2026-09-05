"""建模这一族的算料：拟合分、共线性、每列口径、部分依赖、限深代表树。

四个 model 算子共用这一份。⚠ 一律纯函数、零副作用：算料写进算子类里的话，
几个贴着行数上限的算子文件下一次谁都改不动
（docs/MODELING_RESULT_VIEW_DESIGN.md §8.1）。
⚠ 上限取 `reporting.py` 那一份，不各写各的——多算出来的一截会在构造函数那里被
截掉，等于白算。
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from typing import Any

import numpy as np

from platform_server.apps.modeling.operators.reporting import (
    MAX_PDP,
    MAX_PDP_POINTS,
    MAX_RANGES,
    MAX_TREE_NODES,
    Item,
    Pdp,
    ReportBlock,
)
from platform_server.apps.modeling.operators.steps import ratio_of

# 代表树限深 3：深一层节点数翻倍，配到 5 层就能把整份讲解挤没，而表现是别的图
# 无声消失（规格 §5-19），所以它不做成用户可调的参数
TREE_DEPTH = 3
# 部分依赖曲线：每条几个网格点、背衬取多少行、最多画几条
PDP_POINTS = MAX_PDP_POINTS
PDP_ROWS = 200
PDP_CURVES = 6
# 几率比的指数上限。⚠ `math.exp(710)` 直接抛，而没标准化的列上系数轻易越过它
EXP_LIMIT = 700.0
# sklearn 的树用这个值当「没有左孩子」，即叶节点
NO_CHILD = -1
# 根节点没有父
NO_PARENT = -1
# 走左边是「≤ 阈值」，走右边是「> 阈值」
BRANCH_LOW = "low"
BRANCH_HIGH = "high"


@dataclass(frozen=True)
class Scores:
    """一份预测在一份真值上的拟合分。

    ⚠ 无定义时给 `None` 不给 0：目标列一点不变时 R² 的分母是零，那是「算不
    出来」，印成 0 会被读成「一点都没解释到」。
    """

    rows: int
    r2: float | None
    rmse: float | None


@dataclass(frozen=True)
class RankCheck:
    """设计矩阵的秩与条件数。

    ⚠ 秩亏时系数会剧烈摇摆、符号甚至整体翻过来，而 R² 照样很高——只有这两个数
    看得出来。
    """

    columns: int
    rank: int
    #: 最大奇异值 ÷ 最小奇异值；None = 有奇异值是零，条件数无穷大
    condition: float | None

    @property
    def is_deficient(self) -> bool:
        """列不满秩 = 有列是别的列的线性组合。"""
        return self.rank < self.columns


def scores_of(truth: Sequence[float], predicted: Sequence[float]) -> Scores:
    """一份预测的 R² 与 RMSE。

    Args: truth, predicted。
    """
    rows = len(truth)
    if rows == 0 or rows != len(predicted):
        return Scores(rows=rows, r2=None, rmse=None)
    mean = sum(truth) / rows
    total = sum((value - mean) ** 2 for value in truth)
    squared = sum(
        (value - guess) ** 2
        for value, guess in zip(truth, predicted, strict=True)
    )
    return Scores(
        rows=rows,
        r2=None if total <= 0 else 1.0 - squared / total,
        rmse=math.sqrt(squared / rows),
    )


def rank_check_of(
    rows: Sequence[Sequence[float]], *, use_intercept: bool
) -> RankCheck | None:
    """训练矩阵的秩与条件数；一行都没有时给 `None`。

    ⚠ 拟合截距时把那一列常数一起算进去：某列全是常数时特征之间看着互不相关，
    而它与截距共线，系数照样定不住。
    Args: rows, use_intercept。
    """
    if not rows or not rows[0]:
        return None
    matrix = np.asarray(rows, dtype=float)
    if use_intercept:
        matrix = np.hstack([matrix, np.ones((matrix.shape[0], 1))])
    spectrum = np.linalg.svd(matrix, compute_uv=False)
    largest = float(spectrum[0])
    smallest = float(spectrum[-1])
    tolerance = largest * max(matrix.shape) * float(np.finfo(float).eps)
    return RankCheck(
        columns=int(matrix.shape[1]),
        rank=int(np.count_nonzero(spectrum > tolerance)),
        condition=None if smallest <= tolerance else largest / smallest,
    )


def sigmas_of(
    rows: Sequence[Sequence[float]], keys: Sequence[str]
) -> dict[str, float]:
    """每列在训练集上的标准差。系数可不可比就看它。

    Args: rows, keys。
    """
    if not rows or not rows[0]:
        return {}
    spread = np.asarray(rows, dtype=float).std(axis=0)
    return {
        key: float(spread[seat])
        for seat, key in enumerate(keys)
        if seat < spread.size
    }


def ranges_of(
    rows: Sequence[Sequence[float]], keys: Sequence[str]
) -> list[Item]:
    """每个特征在训练集上的取值区间。

    ⚠ 树在区间之外一律外推成边界叶值，所以这两个数就是「这个模型敢答的范围」。
    Args: rows, keys。
    """
    if not rows or not rows[0]:
        return []
    matrix = np.asarray(rows, dtype=float)
    low = matrix.min(axis=0)
    high = matrix.max(axis=0)
    return [
        {"key": key, "low": float(low[seat]), "high": float(high[seat])}
        for seat, key in enumerate(keys[:MAX_RANGES])
        if seat < low.size
    ]


def class_items(
    values: Sequence[float], classes: Sequence[float]
) -> list[Item]:
    """每一类占了多少行。

    ⚠ 一行都没摊上的类也列出来：类不平衡正是这一栏要答的问题，把它省掉之后
    「这一类一次都没出现」就看不见了。
    Args: values, classes。
    """
    rows = len(values)
    return [
        {
            "name": class_text(one),
            "value": sum(1 for value in values if value == one),
            "ratio": ratio_of(sum(1 for value in values if value == one), rows),
        }
        for one in classes
    ]


def class_text(value: float) -> str:
    """类目印成文本。

    ⚠ 整数不带小数点：`1.0` 与 `1` 在界面上会被读成两个不同的类。
    Args: value。
    """
    return str(int(value)) if float(value).is_integer() else str(value)


def odds_ratio_of(coef: float) -> float | None:
    """exp(β)：这一列每加一个单位，正类的几率乘几倍。

    ⚠ 溢出时给 `None` 不给 inf：inf 落进 JSON 是非法的，而夹到上限会印出一个
    看着像真的巨大倍数。
    Args: coef。
    """
    if not math.isfinite(coef) or abs(coef) > EXP_LIMIT:
        return None
    return math.exp(coef)


def pdp_curves(
    predict: Callable[[list[list[float]]], Sequence[float]],
    rows: Sequence[Sequence[float]],
    keys: Sequence[str],
    *,
    limit: int = PDP_CURVES,
) -> list[Pdp]:
    """每个特征的部分依赖曲线：只动这一列，其余按训练集原样。

    ⚠ 背衬取等距抽样的一撮：整帧逐格重算是「行数 × 网格点数」次预测。
    Args: predict, rows, keys, limit。
    """
    if not rows or not rows[0]:
        return []
    matrix = np.asarray(rows, dtype=float)
    step = max(1, matrix.shape[0] // PDP_ROWS)
    backdrop = matrix[::step][:PDP_ROWS]
    wanted = keys[: max(0, min(limit, MAX_PDP))]
    return [
        Pdp(
            key=key,
            points=_curve_of(predict, backdrop, matrix[:, seat], seat),
        )
        for seat, key in enumerate(wanted)
        if seat < matrix.shape[1]
    ]


def tree_outline(
    estimator: object, keys: Sequence[str], *, depth: int = TREE_DEPTH
) -> Item | None:
    """一棵代表树限深 `depth` 的骨架；拿不到树时给 `None`。

    Args: estimator, keys, depth。
    """
    tree = _first_tree(estimator)
    if tree is None:
        return None
    return {"depth": depth, "nodes": _walked(tree, keys, depth)}


def with_notes(block: ReportBlock, notes: Sequence[str]) -> ReportBlock:
    """给一块挂上这一步必须说清的几句话；一句都没有时原样返回。

    ⚠ 挂在块上而不是笼统摆在屏顶：说的是哪一块的事就摆在哪一块的位置
    （规格 §2-P5）。
    Args: block, notes。
    """
    kept = [text for text in notes if text]
    return (
        block
        if not kept
        else replace(block, payload={**block.payload, "notes": kept})
    )


def as_aux(block: ReportBlock) -> ReportBlock:
    """把一块标成辅图：超预算时它比主体图先走（规格 §4.6）。

    Args: block。
    """
    return replace(block, payload={**block.payload, "is_primary": False})


def _curve_of(
    predict: Callable[[list[list[float]]], Sequence[float]],
    backdrop: Any,
    column: Any,
    seat: int,
) -> list[list[float]]:
    """一条曲线：网格铺在这一列的取值区间上，纵坐标是背衬上的平均预测。

    Args: predict, backdrop, column, seat。
    """
    low = float(column.min())
    high = float(column.max())
    grid = (
        np.linspace(low, high, PDP_POINTS)
        if high > low
        else np.asarray([low], dtype=float)
    )
    points: list[list[float]] = []
    for value in grid:
        probe = backdrop.copy()
        probe[:, seat] = value
        guessed = predict([[float(cell) for cell in row] for row in probe])
        points.append([float(value), sum(guessed) / len(guessed)])
    return points


def _first_tree(estimator: object) -> Any | None:
    """从一棵树或一片集成里取出第一棵树的内部结构。

    ⚠ 两族的形状不同：森林的 `estimators_` 是一串树，提升树的是每轮一排。
    Args: estimator。
    """
    own: Any | None = getattr(estimator, "tree_", None)
    if own is not None:
        return own
    members: Any | None = getattr(estimator, "estimators_", None)
    if members is None or len(members) == 0:
        return None
    first: Any = members[0]
    inner: Any | None = getattr(first, "tree_", None)
    if inner is not None:
        return inner
    return None if len(first) == 0 else getattr(first[0], "tree_", None)


def _walked(tree: Any, keys: Sequence[str], depth: int) -> list[Item]:
    """按层遍历到限定深度，父在前、子在后。

    ⚠ 按层不按深度优先：截断落在最后一层时，留下的仍是一棵完整的上半截树，
    而深度优先截出来的那半棵解释不通（父节点指着已经不在的孩子）。
    Args: tree, keys, depth。
    """
    shape = _TreeShape(tree, keys)
    made: list[Item] = []
    queue: list[tuple[int, int, str, int]] = [(0, NO_PARENT, "", 0)]
    while queue and len(made) < MAX_TREE_NODES:
        seat, parent, branch, level = queue.pop(0)
        is_leaf = shape.left[seat] == NO_CHILD or level >= depth
        made.append(shape.node_at(seat, parent, branch, is_leaf=is_leaf))
        if is_leaf:
            continue
        queue.append((shape.left[seat], seat, BRANCH_LOW, level + 1))
        queue.append((shape.right[seat], seat, BRANCH_HIGH, level + 1))
    return made


class _TreeShape:
    """一棵 sklearn 树摊平成几串纯数。

    ⚠ sklearn 的树结构在类型面上完全未知，收在这一个类里，别散着 getattr。
    """

    def __init__(self, tree: Any, keys: Sequence[str]) -> None:
        self._keys = keys
        self.left: list[int] = [int(item) for item in tree.children_left]
        self.right: list[int] = [int(item) for item in tree.children_right]
        self._features: list[int] = [int(item) for item in tree.feature]
        self._thresholds: list[float] = [float(item) for item in tree.threshold]
        self._samples: list[int] = [int(item) for item in tree.n_node_samples]
        self._values: list[float] = [
            float(np.asarray(item, dtype=float).reshape(-1)[0])
            for item in tree.value
        ]

    def node_at(
        self, seat: int, parent: int, branch: str, *, is_leaf: bool
    ) -> Item:
        """一个节点摆成块里的一行。

        Args: seat, parent, branch, is_leaf。
        """
        feature = self._features[seat]
        named = 0 <= feature < len(self._keys) and not is_leaf
        return {
            "id": seat,
            "parent": parent,
            "branch": branch,
            "key": self._keys[feature] if named else "",
            "threshold": None if not named else self._thresholds[seat],
            "value": self._values[seat],
            "samples": self._samples[seat],
            "is_leaf": is_leaf,
        }
