"""结果面上的「块」：算子把这一步做了什么讲成若干块，界面按区摆。

块自带 `zone` 而不自带顺序，渲染器按一张常量顺序表排——24 个算子分批写出来的
结果面才读着像同一个产品（docs/MODELING_RESULT_VIEW_DESIGN.md §4.3）。
⚠ 每种块的硬上限在这里截断，算子侧只调构造函数、不手拼字典：手拼的那一份不会
被截断，而超出的字节要到落库那一刻才被预算静默削掉。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, get_args

# 一项自由形状的明细。⚠ 只有**外层条数**在这里截断，内层长度由带类型的
# 那几个结构（`CellChange`/`ColumnBins`/`Pdp`）自己保证
type Item = Mapping[str, Any]

# 八种块，一种回答一个问题。⚠ 前端派发表按这张花名册遍历，两侧漂了由双向契约
# 逮住：块的内部形状没有 openapi 保护，键名写错时 typecheck 与 lint 全绿
BlockKind = Literal[
    "rows",
    "columns",
    "cells",
    "fits",
    "bins",
    "axis",
    "breakdown",
    "structure",
]

BLOCK_KINDS: tuple[str, ...] = tuple(get_args(BlockKind))

# 结果面的分区。⚠ 声明顺序就是渲染顺序，别按字母排
Zone = Literal["step", "stats", "charts", "formula", "table"]

ZONES: tuple[str, ...] = tuple(get_args(Zone))

# 降档档位：标量 / 小数组 / 大数组
TIER_SCALAR = 0
TIER_SMALL = 1
TIER_LARGE = 2

# 逐块硬上限（§4.3 的表）
MAX_FUNNEL = 6
MAX_ROW_COLUMNS = 12
MAX_COLUMN_NAMES = 60
MAX_DTYPE_BEFORE = 12
MAX_CELL_COLUMNS = 12
MAX_SAMPLES = 3
MAX_FIT_COLUMNS = 60
MAX_BIN_COLUMNS = 8
MAX_BINS = 40
MAX_MARKS = 4
MAX_OCCUPANCY = 200
MAX_GAPS = 20
MAX_SEGMENTS = 20
MAX_ITEMS = 60
MAX_IMPORTANCES = 60
MAX_RANGES = 60
MAX_TREE_NODES = 31
MAX_PDP = 10
MAX_PDP_POINTS = 20
MAX_LOADINGS = 20
MAX_LOADING_WIDTH = 20
MAX_EXPLAINED = 20


@dataclass(frozen=True)
class ReportBlock:
    """结果面上的一块。跨进程回传，故全是纯数据。"""

    kind: BlockKind
    zone: Zone
    #: 空串 = 节点级，不属于任何一个输出端口
    port: str
    title: str
    #: 0 标量 / 1 小数组 / 2 大数组，超预算时按它与 zone 一起决定谁先丢
    tier: int
    payload: dict[str, Any]


@dataclass(frozen=True)
class BlockAt:
    """一块摆在哪儿。八个构造函数共用这一包，好把形参压在上限内。"""

    zone: Zone
    title: str
    port: str = ""
    tier: int = TIER_SCALAR


@dataclass(frozen=True)
class RowCounts:
    """行数账：进来多少、出去多少、丢了多少、其中空行多少。"""

    before: int
    after: int
    dropped: int = 0
    dropped_blank: int = 0
    #: 用户配的那个比例；None = 这个算子没有比例参数
    ratio_configured: float | None = None
    #: 实际达成的比例。⚠ 与配的那个分开：两者差得远时用户才有得追
    ratio_actual: float | None = None


@dataclass(frozen=True)
class ColumnChange:
    """列的去向：多出来的是谁造的、少掉的是谁删的。"""

    added: Sequence[str] = ()
    removed: Sequence[str] = ()
    kept: int = 0
    #: 换过类型的列原本是什么类型
    dtype_before: Sequence[Item] = ()
    reason: str = ""


@dataclass(frozen=True)
class CellChange:
    """一列上默默改过的那些格。"""

    key: str
    changed: int
    low: float | None = None
    high: float | None = None
    #: 改之前的原值样例，给用户核对用
    samples: Sequence[float | str | None] = ()


@dataclass(frozen=True)
class ColumnBins:
    """一列的分布：桶高、几条参考线、以及落在轴外的那一撮。"""

    key: str
    bins: Sequence[float] = ()
    #: 每条线是 `{at, label, intent}`
    marks: Sequence[Item] = ()
    #: `{label, count}`；None = 没有落在轴外的
    off_axis: Item | None = None


@dataclass(frozen=True)
class TimeAxis:
    """时间轴被怎么动了。"""

    bucket_ms: int | None = None
    tz_offset_minutes: int = 0
    #: 实际起止，RFC3339 UTC。⚠ 不是请求的起止：触顶时两者差得很远
    actual_since: str | None = None
    actual_until: str | None = None
    #: 降采样之后的占用率序列
    occupancy: Sequence[float] = ()
    #: 缺口与区段各是 `{since, until, …}`
    gaps: Sequence[Item] = ()
    segments: Sequence[Item] = ()


@dataclass(frozen=True)
class Scale:
    """一组按项的数是什么口径。界面据它决定要不要按阈值染色。"""

    label: str = ""
    unit: str = ""
    #: 空串 = 没有公认的好坏线，一律灰
    score_kind: str = ""
    baseline: float | None = None


@dataclass(frozen=True)
class Pdp:
    """一个特征的部分依赖曲线，点是 `[x, y]`。"""

    key: str
    points: Sequence[Sequence[float]] = ()


@dataclass(frozen=True)
class ModelStructure:
    """模型内部长什么样。六样各自可缺。"""

    importances: Sequence[Item] = ()
    #: 每个特征的训练区间 `{key, low, high}`
    ranges: Sequence[Item] = ()
    #: 限深代表树 `{depth, nodes}`；深度在造树那一侧限死
    tree: Item | None = None
    pdp: Sequence[Pdp] = ()
    loadings: Sequence[Sequence[float]] = ()
    explained: Sequence[float] = ()


def rows_block(
    at: BlockAt,
    counts: RowCounts,
    *,
    funnel: Sequence[Item] = (),
    by_column: Sequence[Item] = (),
) -> ReportBlock:
    """行数变了多少、谁的锅。

    Args: at, counts, funnel（逐级漏斗）, by_column（按列归因）。
    """
    payload: dict[str, Any] = {
        "before": counts.before,
        "after": counts.after,
        "dropped": counts.dropped,
        "dropped_blank": counts.dropped_blank,
        "ratio_configured": counts.ratio_configured,
        "ratio_actual": counts.ratio_actual,
        "funnel": _items(funnel, MAX_FUNNEL),
        "by_column": _items(by_column, MAX_ROW_COLUMNS),
    }
    return _block("rows", at, payload)


def columns_block(at: BlockAt, change: ColumnChange) -> ReportBlock:
    """列去哪了 / 多出来的是谁造的。

    Args: at, change。
    """
    payload: dict[str, Any] = {
        "added": list(change.added[:MAX_COLUMN_NAMES]),
        "removed": list(change.removed[:MAX_COLUMN_NAMES]),
        "kept": change.kept,
        "dtype_before": _items(change.dtype_before, MAX_DTYPE_BEFORE),
        "reason": change.reason,
    }
    return _block("columns", at, payload)


def cells_block(at: BlockAt, by_column: Sequence[CellChange]) -> ReportBlock:
    """默默改了多少个数。

    Args: at, by_column。
    """
    payload: dict[str, Any] = {
        "by_column": [
            {
                "key": item.key,
                "changed": item.changed,
                "low": item.low,
                "high": item.high,
                "samples": list(item.samples[:MAX_SAMPLES]),
            }
            for item in by_column[:MAX_CELL_COLUMNS]
        ]
    }
    return _block("cells", at, payload)


def fits_block(
    at: BlockAt,
    *,
    method: str,
    train_rows: int,
    total_rows: int,
    by_column: Sequence[Item] = (),
) -> ReportBlock:
    """学到了什么、能不能核对。

    ⚠ 训练行数与总行数分开记：带拟合的算子只在将来会进训练集的行上学统计量，
    两个数不一样才是对的。
    Args: at, method, train_rows, total_rows, by_column。
    """
    payload: dict[str, Any] = {
        "method": method,
        "train_rows": train_rows,
        "total_rows": total_rows,
        "by_column": _items(by_column, MAX_FIT_COLUMNS),
    }
    return _block("fits", at, payload)


def bins_block(at: BlockAt, by_column: Sequence[ColumnBins]) -> ReportBlock:
    """这条线画在哪、分布长什么样。

    Args: at, by_column。
    """
    payload: dict[str, Any] = {
        "by_column": [
            {
                "key": item.key,
                "bins": list(item.bins[:MAX_BINS]),
                "marks": _items(item.marks, MAX_MARKS),
                "off_axis": _mapping(item.off_axis),
            }
            for item in by_column[:MAX_BIN_COLUMNS]
        ]
    }
    return _block("bins", at, payload)


def axis_block(at: BlockAt, axis: TimeAxis) -> ReportBlock:
    """时间轴被怎么动了。

    Args: at, axis。
    """
    payload: dict[str, Any] = {
        "bucket_ms": axis.bucket_ms,
        "tz_offset_minutes": axis.tz_offset_minutes,
        "actual_since": axis.actual_since,
        "actual_until": axis.actual_until,
        "occupancy": list(axis.occupancy[:MAX_OCCUPANCY]),
        "gaps": _items(axis.gaps, MAX_GAPS),
        "segments": _items(axis.segments, MAX_SEGMENTS),
    }
    return _block("axis", at, payload)


def breakdown_block(
    at: BlockAt, scale: Scale, items: Sequence[Item]
) -> ReportBlock:
    """按项的一组数。

    ⚠ 列名当指标键塞进扁平的 `metrics` 字典是**键空间冲突**：某列恰好叫 `mape`
    时，无量纲的数会被印上百分号。按项的数一律走这里。
    Args: at, scale, items。
    """
    payload: dict[str, Any] = {
        "label": scale.label,
        "unit": scale.unit,
        "score_kind": scale.score_kind,
        "baseline": scale.baseline,
        "items": _items(items, MAX_ITEMS),
    }
    return _block("breakdown", at, payload)


def structure_block(at: BlockAt, structure: ModelStructure) -> ReportBlock:
    """模型内部长什么样。

    Args: at, structure。
    """
    payload: dict[str, Any] = {
        "importances": _items(structure.importances, MAX_IMPORTANCES),
        "ranges": _items(structure.ranges, MAX_RANGES),
        "tree": _tree(structure.tree),
        "pdp": [
            {"key": item.key, "points": _points(item.points)}
            for item in structure.pdp[:MAX_PDP]
        ],
        "loadings": [
            list(row[:MAX_LOADING_WIDTH])
            for row in structure.loadings[:MAX_LOADINGS]
        ],
        "explained": list(structure.explained[:MAX_EXPLAINED]),
    }
    return _block("structure", at, payload)


def _block(
    kind: BlockKind, at: BlockAt, payload: dict[str, Any]
) -> ReportBlock:
    return ReportBlock(
        kind=kind,
        zone=at.zone,
        port=at.port,
        title=at.title,
        tier=at.tier,
        payload=payload,
    )


def _items(items: Sequence[Item], limit: int) -> list[dict[str, Any]]:
    """把一串明细截到上限，并各自拷成普通字典。

    Args: items, limit。
    """
    return [dict(item) for item in items[:limit]]


def _points(points: Sequence[Sequence[float]]) -> list[list[float]]:
    """曲线上的点截到上限。

    Args: points。
    """
    return [list(point) for point in points[:MAX_PDP_POINTS]]


def _mapping(item: Item | None) -> dict[str, Any] | None:
    """可缺的一小包拷成普通字典。

    Args: item。
    """
    return None if item is None else dict(item)


def _tree(tree: Item | None) -> dict[str, Any] | None:
    """代表树的节点数截到上限。

    ⚠ 深度在**造树那一侧**限死：这里只截节点数，截深度会留下一棵解释不通的
    半截树（父节点指着已经不在的孩子）。
    Args: tree。
    """
    if tree is None:
        return None
    kept = dict(tree)
    nodes: Sequence[Item] = kept.get("nodes") or ()
    kept["nodes"] = _items(nodes, MAX_TREE_NODES)
    return kept
