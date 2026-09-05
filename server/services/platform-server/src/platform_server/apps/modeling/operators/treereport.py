"""树回归的结果面算料：重要性、部分依赖、训练取值区间与限深代表树。

⚠ 树走**通道 B**：拟合参数是一堆树对象、封在二进制产物里，`fitted` 刻意空着，
所以这一步画不出一行带系数的公式——那不是「还没训出来」，下面这几张图就是它
能讲的全部（docs/MODELING_RESULT_VIEW_DESIGN.md §5-19）。
⚠ 算料与算子类分开：`trees.py` 与别的算子文件一样贴着行数上限（§8.1）。
"""

from collections.abc import Sequence
from dataclasses import dataclass

from platform_server.apps.modeling.operators.estimators import TreeEnsemble
from platform_server.apps.modeling.operators.frame import (
    Frame,
    matrix_of,
    numbers_of,
)
from platform_server.apps.modeling.operators.modelstats import (
    TREE_DEPTH,
    Scores,
    pdp_curves,
    ranges_of,
    scores_of,
    tree_outline,
    with_notes,
)
from platform_server.apps.modeling.operators.reporting import (
    TIER_LARGE,
    TIER_SCALAR,
    BlockAt,
    Item,
    ModelStructure,
    Pdp,
    ReportBlock,
    Scale,
    breakdown_block,
    structure_block,
)

# 梯度提升那一档的代号，与 `TreeRegressorConfig.shape` 同字面量
GBDT = "gbdt"
# 训练分比测试分高出这么多就该提醒：这片树把训练数据背下来了
OVERFIT_GAP = 0.2
# 拿不到重要性的列按这个分排——排在最后，而不是冒充零重要
UNRANKED = -1.0

GIST_LABEL = "在多少行多少列上拟合的，以及这一步给多少行打了分"
SHAPE_LABEL = "这片树长成什么样，以及它在训练集与测试集上各得几分"

CHANNEL_NOTE = (
    "拟合参数是一堆树对象，纯 JSON 表达不出来，所以它们封在二进制产物里而不在"
    "结果里——这不是「还没训出来」；也正因为没有系数，这一步写不出一行公式，"
    "下面那几张图就是这个模型能讲的全部"
)
GBDT_RATE_NOTE = (
    "学习率用的是 sklearn 的默认 0.1：这一步只传了棵数、深度与随机种子，"
    "这个参数你改不了也看不见"
)
UNLIMITED_DEPTH_NOTE = (
    "没有限深度：每棵树一直长到叶子纯为止，训练分必然贴着 1，"
    "它说明不了这个模型在没见过的数据上好不好"
)
OVERFIT_NOTE = (
    "训练集 R² {train:.3f}、测试集 {test:.3f}，差了 {gap:.3f}："
    "这片树把训练数据背下来了，换一批新数据不会有这么准——限一下每棵树的深度"
    "或者少长几棵，再跑一次"
)
NO_EXTRAPOLATION_NOTE = (
    "树不外推：某一列的输入落在下面那张训练取值区间之外时，预测值恒等于边界上"
    "的叶值——既不报错，也不会跟着继续往上走"
)
PDP_NOTE = (
    "部分依赖是「只动这一列、其余按训练集原样」重算一遍的平均预测："
    "曲线两端一平，就是它不再往外走的地方"
)
PDP_PICK_NOTE = "特征有 {total} 列，部分依赖只画重要性最高的那 {shown} 列"
TREE_SAMPLE_NOTE = (
    "下面那棵是这片集成里的第一棵，且只画到第 {depth} 层：整片有 {count} 棵，"
    "而一棵长满的树光节点就有两千个，画全了会把这一屏别的图挤没"
)


@dataclass(frozen=True)
class TreeTrained:
    """一次树集成拟合实际看到了什么，块照它讲。"""

    trees: TreeEnsemble
    train: Frame
    test: Frame
    keys: tuple[str, ...]
    target: str
    #: 测试集上的预测，与 `test` 同序
    predicted: list[float]
    #: forest 还是 gbdt
    kind: str
    #: 用户配的最深层数；0 = 不限
    depth_configured: int


def tree_blocks(seen: TreeTrained) -> tuple[ReportBlock, ...]:
    """三块：这一步拟了什么、集成结构与两侧拟合分、模型内部那几张图。

    Args: seen。
    """
    rows = matrix_of(seen.train, seen.keys)
    ranked = _importance_items(seen)
    return (
        _gist_block(seen),
        _shape_block(seen, rows),
        _inside_block(seen, rows, ranked),
    )


def _gist_block(seen: TreeTrained) -> ReportBlock:
    """在多少行多少列上拟合的，外加通道 B 那条必须先说清的话。

    Args: seen。
    """
    items: list[Item] = [
        {"name": "训练行数", "value": seen.train.row_count},
        {"name": "特征列数", "value": len(seen.keys)},
        {"name": "打分行数", "value": seen.test.row_count},
    ]
    block = breakdown_block(
        BlockAt(zone="step", title="拟合概况", tier=TIER_SCALAR),
        Scale(label=GIST_LABEL),
        items,
    )
    return with_notes(block, _gist_notes(seen))


def _gist_notes(seen: TreeTrained) -> tuple[str, ...]:
    """通道 B 一条，梯度提升再加一条改不了也看不见的学习率。

    Args: seen。
    """
    made = [CHANNEL_NOTE]
    if seen.kind == GBDT:
        made.append(GBDT_RATE_NOTE)
    return tuple(made)


def _shape_block(
    seen: TreeTrained, rows: Sequence[Sequence[float]]
) -> ReportBlock:
    """几棵树、最深几层、多少个叶子，以及两侧各得几分。

    ⚠ 两侧的分要并排摆：树很容易把训练集背下来，只印一个训练分等于在骗人。
    Args: seen, rows。
    """
    shape = seen.trees.shape
    train = _scored(seen.train, seen.target, seen.trees.predict(list(rows)))
    test = _scored(seen.test, seen.target, seen.predicted)
    items: list[Item] = [
        {"name": "树的棵数", "value": shape.count, "unit": "棵"},
        {"name": "最深几层", "value": shape.depth, "unit": "层"},
        {"name": "叶子总数", "value": shape.leaves, "unit": "个"},
        _score_item("训练集 R²", train.r2),
        _score_item("测试集 R²", test.r2),
    ]
    block = breakdown_block(
        BlockAt(zone="stats", title="集成结构与两侧拟合分", tier=TIER_SCALAR),
        Scale(label=SHAPE_LABEL),
        items,
    )
    return with_notes(block, _shape_notes(seen, train, test))


def _score_item(name: str, value: float | None) -> Item:
    """一张分数卡。⚠ 算不出来给 `None`：目标列一点不变时 R² 没有定义。

    Args: name, value。
    """
    return {"name": name, "value": value, "score_kind": "r2"}


def _shape_notes(
    seen: TreeTrained, train: Scores, test: Scores
) -> tuple[str, ...]:
    """没限深度、以及两侧分差得远这两条只有这一步看得见的告警。

    Args: seen, train, test。
    """
    made: list[str] = []
    if seen.depth_configured == 0 and seen.kind != GBDT:
        made.append(UNLIMITED_DEPTH_NOTE)
    if train.r2 is None or test.r2 is None:
        return tuple(made)
    gap = train.r2 - test.r2
    if gap > OVERFIT_GAP:
        made.append(OVERFIT_NOTE.format(train=train.r2, test=test.r2, gap=gap))
    return tuple(made)


def _inside_block(
    seen: TreeTrained, rows: Sequence[Sequence[float]], ranked: list[Item]
) -> ReportBlock:
    """重要性、部分依赖、每列的训练取值区间、以及一棵限深代表树。

    Args: seen, rows, ranked。
    """
    structure = ModelStructure(
        importances=ranked,
        ranges=ranges_of(rows, seen.keys),
        tree=tree_outline(seen.trees.estimator, seen.keys),
        pdp=_pdp_of(seen, rows, [str(item["key"]) for item in ranked]),
    )
    block = structure_block(
        BlockAt(
            zone="charts",
            title="重要性、部分依赖与训练取值区间",
            tier=TIER_LARGE,
        ),
        structure,
    )
    return with_notes(block, _inside_notes(seen, len(structure.pdp)))


def _inside_notes(seen: TreeTrained, shown: int) -> tuple[str, ...]:
    """不外推、部分依赖怎么读、只画了几条、代表树是哪一棵。

    Args: seen, shown。
    """
    made = [NO_EXTRAPOLATION_NOTE, PDP_NOTE]
    total = len(seen.keys)
    if total > shown:
        made.append(PDP_PICK_NOTE.format(total=total, shown=shown))
    count = seen.trees.shape.count
    if count:
        made.append(TREE_SAMPLE_NOTE.format(depth=TREE_DEPTH, count=count))
    return tuple(made)


def _importance_items(seen: TreeTrained) -> list[Item]:
    """按重要性从高到低的一串 `{key, value}`。

    ⚠ 先排序再截断：按列序截的话，最重要的那一列恰好排在第 61 位时，整张图上
    就没有它。
    Args: seen。
    """
    scores = seen.trees.importances
    paired = [
        (scores[seat] if seat < len(scores) else UNRANKED, key)
        for seat, key in enumerate(seen.keys)
    ]
    paired.sort(key=_by_score)
    return [{"key": key, "value": score} for score, key in paired]


def _by_score(pair: tuple[float, str]) -> float:
    """排序键：分高的在前，同分的保持列序。

    Args: pair。
    """
    return -pair[0]


def _pdp_of(
    seen: TreeTrained, rows: Sequence[Sequence[float]], ranked: list[str]
) -> list[Pdp]:
    """按重要性挑前几列画部分依赖。

    ⚠ 换列要连矩阵一起换位、再在预测那一步换回来：估计器按**训练时的列序**取
    值，只把 key 排个序的话，每条曲线动的都是别的列，而画出来的图看着完全正常。
    Args: seen, rows, ranked。
    """
    order = [seen.keys.index(key) for key in ranked]

    def predict(probe: list[list[float]]) -> Sequence[float]:
        return seen.trees.predict([_restored(row, order) for row in probe])

    shuffled = [[row[seat] for seat in order] for row in rows]
    return pdp_curves(predict, shuffled, ranked)


def _restored(row: Sequence[float], order: Sequence[int]) -> list[float]:
    """把换过位的一行摆回训练时的列序。

    Args: row, order。
    """
    made = [0.0] * len(order)
    for seat, origin in enumerate(order):
        made[origin] = row[seat]
    return made


def _scored(frame: Frame, target: str, guessed: Sequence[float]) -> Scores:
    """一侧的拟合分。

    ⚠ 目标列上的空值在这一步之前就被挡掉了（训练那侧在 `_fit` 里抛、测试那侧
    在 `scored_frame` 里抛），所以这里不补 0：真漏进来一个，两串就长短不一，
    `scores_of` 给的是「算不出来」，而补出来的巨大误差会把 R² 压成一个假数。
    Args: frame, target, guessed。
    """
    truth = [value for value in numbers_of(frame, target) if value is not None]
    return scores_of(truth, list(guessed))
