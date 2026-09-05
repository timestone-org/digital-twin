"""填缺失与离群裁剪的结果面算料：逐列的表、格子账、以及处理前的分布。

两个算子都在训练行上学一份参数、再施加到整帧，讲的话因此同构。⚠ 算料与算子
类分开：`preprocess.py` 贴着行数上限，写回去之后谁都改不动
（docs/MODELING_RESULT_VIEW_DESIGN.md §8.1）。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any

from platform_server.apps.modeling.operators.frame import Frame, numbers_of
from platform_server.apps.modeling.operators.reporting import (
    MAX_BIN_COLUMNS,
    MAX_CELL_COLUMNS,
    TIER_LARGE,
    TIER_SCALAR,
    TIER_SMALL,
    BlockAt,
    CellChange,
    ColumnBins,
    Item,
    ReportBlock,
    bins_block,
    cells_block,
    fits_block,
)
from platform_server.apps.modeling.operators.steps import (
    column_bins,
    ratio_of,
    samples_of,
    spread_of,
)

# 这两个算子各只有一路输出，讲解全挂在它上面
PORT = "frame"
# 学不出参数的那几列照列进表，只是那几栏空着
NO_FILL_REASON = "训练行上这一列全是空值，按配置没有填"
NO_BOUND_REASON = "训练行上这一列的取值太少，定不出上下界"


@dataclass(frozen=True)
class ColumnFit:
    """一列在训练行上学到了什么。

    ⚠ `stats` 为 `None` = 这一列压根没学出来，不是「学出来是零」。
    """

    #: 训练行里非空的格数。⚠ 用户拿全表均值核对填充值对不上，就是因为它
    rows: int
    stats: Mapping[str, float] | None = None


@dataclass(frozen=True)
class Bound:
    """一列的上下界。"""

    low: float
    high: float


@dataclass(frozen=True)
class FillRun:
    """填缺失这一步实际做了什么，`fill_blocks` 照它讲。"""

    #: 填之前那一份
    source: Frame
    #: 这一步点名要处理的列，含没填成的
    keys: tuple[str, ...]
    fills: Mapping[str, float]
    fit: Mapping[str, ColumnFit]
    train_rows: int
    strategy: str


@dataclass(frozen=True)
class ClipRun:
    """离群裁剪这一步实际做了什么，`clip_blocks` 照它讲。"""

    #: 裁之前那一份
    source: Frame
    #: 定界所用的那些行
    train: Frame
    keys: tuple[str, ...]
    bounds: Mapping[str, Bound]
    fit: Mapping[str, ColumnFit]
    method: str
    threshold: float
    #: 图里有没有切分。没有切分就没有训练段之外的行
    is_split: bool


def fill_blocks(run: FillRun) -> tuple[ReportBlock, ...]:
    """填缺失的三块：填了多少格、逐列填充表、填充前分布。

    Args: run。
    """
    return (_fill_cells(run), _fill_fits(run), _aux(_fill_bins(run)))


def clip_blocks(run: ClipRun) -> tuple[ReportBlock, ...]:
    """离群裁剪的三块：夹了多少格、逐列定界表、裁剪前分布。

    Args: run。
    """
    touched = {key: _touch_of(run, key) for key in run.keys}
    return (
        _clip_cells(run, touched),
        _clip_fits(run, touched),
        _aux(_clip_bins(run, touched)),
    )


@dataclass(frozen=True)
class _Touch:
    """一列上真被夹到界上的那些格。"""

    low: int
    high: int
    untouched: int
    #: 被夹之前的原值样例，按行序取前几个
    samples: Sequence[float | str | None]

    @property
    def changed(self) -> int:
        """两头合起来一共动了多少格。"""
        return self.low + self.high


def _fill_cells(run: FillRun) -> ReportBlock:
    """填了多少格，多的排前面。

    ⚠ 一格没填的列不列：这一栏答的是「哪几列被动过」，把没份的列也摆上去只会
    把真正那几列挤出上限。
    Args: run。
    """
    counted = [
        (key, _null_count(run.source, key))
        for key in run.keys
        if key in run.fills
    ]
    filled = [pair for pair in counted if pair[1] > 0]
    filled.sort(key=lambda pair: (-pair[1], pair[0]))
    return cells_block(
        BlockAt(zone="step", title="填了多少格", port=PORT, tier=TIER_SCALAR),
        [
            CellChange(key=key, changed=count)
            for key, count in filled[:MAX_CELL_COLUMNS]
        ],
    )


def _fill_fits(run: FillRun) -> ReportBlock:
    """逐列：填了什么值、填了多少格、填前空值率、拟合样本数。

    Args: run。
    """
    return fits_block(
        BlockAt(zone="table", title="逐列填充", port=PORT, tier=TIER_SMALL),
        method=run.strategy,
        train_rows=run.train_rows,
        total_rows=run.source.row_count,
        by_column=[_fill_row(run, key) for key in run.keys],
    )


def _fill_row(run: FillRun, key: str) -> Item:
    """一列在填充表里的那一行；没填成的列照列，只是填充值那一栏空着。

    Args: run, key。
    """
    fill = run.fills.get(key)
    nulls = _null_count(run.source, key)
    fit = run.fit.get(key)
    return {
        "key": key,
        "params": {
            "fill": fill,
            "filled": nulls if fill is not None else 0,
            "null_ratio_before": ratio_of(nulls, run.source.row_count),
            "fit_rows": None if fit is None else fit.rows,
        },
        "skipped_reason": "" if fill is not None else NO_FILL_REASON,
    }


def _fill_bins(run: FillRun) -> ReportBlock:
    """填充前的分布，填充值画一条线。

    ⚠ 用均值填掉三成的空会在正中堆出一根假柱、把方差压平——那件事只有这张图
    看得见，逐列的表上每个数都很正常。
    Args: run。
    """
    keys = [key for key in run.keys if key in run.fills]
    ranked = sorted(keys, key=lambda key: (-_null_count(run.source, key), key))
    return bins_block(
        BlockAt(zone="charts", title="填充前分布", port=PORT, tier=TIER_LARGE),
        [_fill_column(run, key) for key in ranked[:MAX_BIN_COLUMNS]],
    )


def _fill_column(run: FillRun, key: str) -> ColumnBins:
    """一列填充前的分布与那条填充值竖线。

    Args: run, key。
    """
    mark: Item = {
        "at": run.fills[key],
        "label": "填充值",
        "intent": "warning",
    }
    return column_bins(
        key, spread_of(numbers_of(run.source, key)), marks=(mark,)
    )


def _clip_cells(run: ClipRun, touched: Mapping[str, _Touch]) -> ReportBlock:
    """夹了多少格，多的排前面；一格没动的列不列。

    Args: run, touched。
    """
    changed = [key for key in run.keys if touched[key].changed > 0]
    changed.sort(key=lambda key: (-touched[key].changed, key))
    return cells_block(
        BlockAt(zone="step", title="夹了多少格", port=PORT, tier=TIER_SCALAR),
        [
            _clip_cell(run, key, touched[key])
            for key in changed[:MAX_CELL_COLUMNS]
        ],
    )


def _clip_cell(run: ClipRun, key: str, touch: _Touch) -> CellChange:
    """一列上被夹掉的那些格，连同夹它的那两个数。

    Args: run, key, touch。
    """
    bound = run.bounds.get(key)
    return CellChange(
        key=key,
        changed=touch.changed,
        low=None if bound is None else bound.low,
        high=None if bound is None else bound.high,
        samples=touch.samples,
    )


def _clip_fits(run: ClipRun, touched: Mapping[str, _Touch]) -> ReportBlock:
    """逐列：怎么定的界、定出来是多少、两头各夹了多少格。

    Args: run, touched。
    """
    return fits_block(
        BlockAt(zone="table", title="逐列定界", port=PORT, tier=TIER_SMALL),
        method=run.method,
        train_rows=run.train.row_count,
        total_rows=run.source.row_count,
        by_column=[_clip_row(run, key, touched[key]) for key in run.keys],
    )


def _clip_row(run: ClipRun, key: str, touch: _Touch) -> Item:
    """一列在定界表里的那一行。

    ⚠ 参数、触界计数与两段的取值范围合在同一包里：`fits` 块的每列只有 `params`
    这一个自由字典。
    Args: run, key, touch。
    """
    bound = run.bounds.get(key)
    fit = run.fit.get(key)
    stats: Mapping[str, float] = (
        {} if fit is None or fit.stats is None else fit.stats
    )
    return {
        "key": key,
        "params": {
            "k": run.threshold,
            "mean": stats.get("mean"),
            "sd": stats.get("sd"),
            "q1": stats.get("q1"),
            "q3": stats.get("q3"),
            "low": None if bound is None else bound.low,
            "high": None if bound is None else bound.high,
            "clipped_low": touch.low,
            "clipped_high": touch.high,
            "untouched": touch.untouched,
            "fit_rows": None if fit is None else fit.rows,
            **_reach(run, key),
        },
        "skipped_reason": "" if bound is not None else NO_BOUND_REASON,
    }


def _reach(run: ClipRun, key: str) -> dict[str, Any]:
    """训练段与整帧各自的取值范围，外加「训练段之外的行越出了它」这条判断。

    ⚠ 界在训练行上定、裁的却是整帧，故整帧的极值超出训练段的极值，就是「有测
    试行超出了训练分布」的证据（规格 §11 的 R-21）。图里没有切分时给 `None`：
    那时压根没有训练段之外的行，答 `False` 是替用户下了没根据的结论。
    Args: run, key。
    """
    train = _extent(run.train, key)
    whole = _extent(run.source, key)
    beyond = None
    if run.is_split and train is not None and whole is not None:
        beyond = whole[0] < train[0] or whole[1] > train[1]
    return {
        "train_low": None if train is None else train[0],
        "train_high": None if train is None else train[1],
        "all_low": None if whole is None else whole[0],
        "all_high": None if whole is None else whole[1],
        "beyond_train": beyond,
    }


def _clip_bins(run: ClipRun, touched: Mapping[str, _Touch]) -> ReportBlock:
    """裁剪前的分布，上下界各画一条线；夹得最多的那几列排前面。

    Args: run, touched。
    """
    keys = [key for key in run.keys if key in run.bounds]
    keys.sort(key=lambda key: (-touched[key].changed, key))
    return bins_block(
        BlockAt(zone="charts", title="裁剪前分布", port=PORT, tier=TIER_LARGE),
        [_clip_column(run, key) for key in keys[:MAX_BIN_COLUMNS]],
    )


def _clip_column(run: ClipRun, key: str) -> ColumnBins:
    """一列裁剪前的分布与那两条界线。

    ⚠ 轴按这一列**裁剪前**的实际跨度铺，不按上下界铺：按界铺的话越界的格会被
    压进两端的柱子，而「有没有行越界」正是这张图要回答的。
    Args: run, key。
    """
    bound = run.bounds[key]
    marks: tuple[Item, ...] = (
        {"at": bound.low, "label": "下界", "intent": "danger"},
        {"at": bound.high, "label": "上界", "intent": "danger"},
    )
    return column_bins(key, spread_of(numbers_of(run.source, key)), marks=marks)


def _touch_of(run: ClipRun, key: str) -> _Touch:
    """一列上有多少格夹到了下界、多少格夹到了上界、多少格原样没动。

    Args: run, key。
    """
    bound = run.bounds.get(key)
    values = [
        value for value in numbers_of(run.source, key) if value is not None
    ]
    if bound is None:
        return _Touch(0, 0, len(values), ())
    low = sum(1 for value in values if value < bound.low)
    high = sum(1 for value in values if value > bound.high)
    outside = [
        value for value in values if value < bound.low or value > bound.high
    ]
    return _Touch(low, high, len(values) - low - high, samples_of(outside))


def _extent(frame: Frame, key: str) -> tuple[float, float] | None:
    """一列非空取值的两端；一个非空取值都没有时给 `None`。

    Args: frame, key。
    """
    values = [value for value in numbers_of(frame, key) if value is not None]
    return (min(values), max(values)) if values else None


def _null_count(frame: Frame, key: str) -> int:
    """一列有多少个空格。

    Args: frame, key。
    """
    return sum(1 for value in numbers_of(frame, key) if value is None)


def _aux(block: ReportBlock) -> ReportBlock:
    """标成辅图：超预算时辅图先走，主体那一块最后丢（规格 §4.6）。

    Args: block。
    """
    return replace(block, payload={**block.payload, "is_primary": False})
