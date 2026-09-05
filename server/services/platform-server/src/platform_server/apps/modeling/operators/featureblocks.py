"""标准化、独热与特征筛选的结果面算料：逐列尺度、类目命中、打分排行。

三个算子都在训练行上学一份参数再施加到整帧，讲的话因此同构。⚠ 算料与算子类
分开：`feature.py` 与 `reduction.py` 都贴着行数上限，写回去之后谁都改不动
（docs/MODELING_RESULT_VIEW_DESIGN.md §8.1）。
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from statistics import median
from typing import Any

from platform_server.apps.modeling.operators.frame import Frame, numbers_of
from platform_server.apps.modeling.operators.reporting import (
    MAX_BIN_COLUMNS,
    MAX_CELL_COLUMNS,
    NOTE_HINT,
    TIER_LARGE,
    TIER_SCALAR,
    TIER_SMALL,
    BlockAt,
    CellChange,
    ColumnChange,
    Item,
    ReportBlock,
    Scale,
    annotated,
    bins_block,
    breakdown_block,
    cells_block,
    columns_block,
    fits_block,
)
from platform_server.apps.modeling.operators.steps import (
    column_bins,
    ratio_of,
    samples_of,
    spread_of,
)

# 三个算子各只有一路输出，讲解全挂在它上面
PORT = "frame"
# 一列上的四个点，前后两侧同一套口径
_POINTS = ("min", "p50", "mean", "max")

# 常量列那一档没学出尺度，这一列照进表，只是尺度那几栏空着
SKIPPED_SCALE_REASON = "训练行上这一列只有一个取值，按配置原样放过、没有缩放"
# 拿全帧均值核对缩放结果对不上的原因
MEAN_NOTE = (
    "μ 只在训练行上学、列统计却在整帧上算，"
    "所以缩放之后界面上这一列的均值不会正好是 0"
)
# z 分数与 0~1 都是无量纲的
UNIT_NOTE = "这几列缩放后没有量纲，原来的单位已经一并清掉"
# 一个类目都没命中的行分两种，两种要用户做的事不一样
MISS_NOTE = (
    "一个类目都没命中的行分两种：未见过的类目（含被 keep_top 砍掉的那几个）"
    "与本来就是空。两种都落全零，但前者要调类目上限、后者要先填缺失"
)
# 下游切分不是恰好一个时，防泄漏整个失效
DEGRADED_REASON = (
    "图里下游的切分不是恰好一个（一个都没有，或者有两个），"
    "这一步于是在整帧上排名——测试行的信息进了这份排名，"
    "上游带拟合的算子也跟着在整帧上拟合"
)
# 方差档的量纲陷阱。⚠ 写成提示不写成断言：上游有没有标准化，这一步看不见
VARIANCE_HINT = (
    "方差对量纲敏感，单位大的列方差天然大。"
    "如果上游没有标准化，这份排名看起来更像是「单位大的那几列」"
)

# 打分口径的叫法，界面按它给这排条子起名
SCORE_LABELS = {
    "variance": "方差",
    "correlation": "与目标列相关性的绝对值",
}


@dataclass(frozen=True)
class ScaleRun:
    """标准化这一步实际做了什么，`scale_blocks` 照它讲。"""

    #: 缩放前那一份
    source: Frame
    #: 缩放后那一份
    result: Frame
    #: 这一步点名要处理的列，含没学出尺度的
    keys: tuple[str, ...]
    scales: Mapping[str, Mapping[str, float]]
    #: 每列在训练行上有多少个非空格
    fit_rows: Mapping[str, int]
    train_rows: int
    method: str


@dataclass(frozen=True)
class OneHotRun:
    """独热编码这一步实际做了什么，`one_hot_blocks` 照它讲。"""

    #: 编码前那一份
    source: Frame
    #: 编码后那一份
    result: Frame
    keys: tuple[str, ...]
    #: 留下来的类目，顺序即编码位
    categories: Mapping[str, Sequence[str]]
    #: 训练行上出现过的全部类目与频次，含被砍掉的那几个
    ranked: Mapping[str, Sequence[tuple[str, int]]]
    train_rows: int


@dataclass(frozen=True)
class SelectRun:
    """特征筛选这一步实际做了什么，`select_blocks` 照它讲。"""

    #: 筛之后那一份
    result: Frame
    candidates: tuple[str, ...]
    scores: Mapping[str, float]
    kept: Sequence[str]
    removed: Sequence[str]
    method: str
    top_k: int
    train_rows: int
    #: 下游切分不是恰好一个——排名与上游拟合都退化到整帧上
    is_degraded: bool


def scale_blocks(run: ScaleRun) -> tuple[ReportBlock, ...]:
    """标准化的三块：换了多少个数、逐列尺度表、缩放前分布。

    Args: run。
    """
    return (_scale_cells(run), _scale_fits(run), _scale_bins(run))


def one_hot_blocks(run: OneHotRun) -> tuple[ReportBlock, ...]:
    """独热编码的三块：列 diff、类目命中、逐列类目账。

    Args: run。
    """
    misses = {key: _misses_of(run, key) for key in run.keys}
    return (
        _one_hot_columns(run),
        _one_hot_breakdown(run),
        _hinted(_one_hot_fits(run, misses), (MISS_NOTE,)),
    )


def select_blocks(run: SelectRun) -> tuple[ReportBlock, ...]:
    """特征筛选的两块：保留与淘汰、打分排行。

    Args: run。
    """
    return (_select_columns(run), _select_breakdown(run))


@dataclass(frozen=True)
class _Misses:
    """一列上编不出任何一个 1 的那些行。

    ⚠ 两项分开记：`_flags` 对空值也返回全零，合成一项会把「该调类目上限」与
    「该先填缺失」算成同一笔账（规格 §11 的 R-13）。
    """

    hit: int
    unseen: int
    blank: int


def _scale_cells(run: ScaleRun) -> ReportBlock:
    """换了多少个数，多的排前面；没学出尺度的列不列。

    Args: run。
    """
    counted = [
        (key, _present_count(run.source, key))
        for key in run.keys
        if key in run.scales
    ]
    counted.sort(key=lambda pair: (-pair[1], pair[0]))
    block = cells_block(
        BlockAt(zone="step", title="换了多少个数", port=PORT, tier=TIER_SCALAR),
        [
            CellChange(
                key=key,
                changed=count,
                samples=samples_of(_present(run.source, key)),
            )
            for key, count in counted[:MAX_CELL_COLUMNS]
        ],
    )
    return _hinted(block, (MEAN_NOTE, *_unit_note(run)))


def _unit_note(run: ScaleRun) -> tuple[str, ...]:
    """缩放过的列原本带着单位时，说一句单位去哪了。

    ⚠ 原本就没单位的话这句话是句废话，那时一个字都不说。
    Args: run。
    """
    worn = any(
        run.source.column_of(key).unit for key in run.keys if key in run.scales
    )
    return (UNIT_NOTE,) if worn else ()


def _scale_fits(run: ScaleRun) -> ReportBlock:
    """逐列：中心、跨度、训练样本数，以及缩放前后各自的四个点。

    Args: run。
    """
    return fits_block(
        BlockAt(zone="table", title="逐列尺度", port=PORT, tier=TIER_SMALL),
        method=run.method,
        train_rows=run.train_rows,
        total_rows=run.source.row_count,
        by_column=[_scale_row(run, key) for key in run.keys],
    )


def _scale_row(run: ScaleRun, key: str) -> Item:
    """一列在尺度表里的那一行；没学出尺度的列照列，只是那几栏空着。

    Args: run, key。
    """
    scale = run.scales.get(key)
    return {
        "key": key,
        "params": {
            "center": None if scale is None else scale["center"],
            "scale": None if scale is None else scale["scale"],
            "fit_rows": run.fit_rows.get(key),
            **_four_points(numbers_of(run.source, key), "before"),
            **_four_points(numbers_of(run.result, key), "after"),
        },
        "skipped_reason": "" if scale is not None else SKIPPED_SCALE_REASON,
    }


def _scale_bins(run: ScaleRun) -> ReportBlock:
    """缩放前的分布，中心与一个跨度各画一条线；跨度大的列排前面。

    ⚠ 只画缩放前那一张：两种缩放都是仿射变换，缩放后的直方图形状与它一模一样，
    换的只是横轴刻度——那张图上的四个点在尺度表里。
    Args: run。
    """
    keys = [key for key in run.keys if key in run.scales]
    keys.sort(key=lambda key: (-run.scales[key]["scale"], key))
    return bins_block(
        BlockAt(
            zone="charts",
            title="缩放前分布",
            port=PORT,
            tier=TIER_LARGE,
            is_primary=True,
        ),
        [
            column_bins(
                key,
                spread_of(numbers_of(run.source, key)),
                marks=_scale_marks(run, key),
            )
            for key in keys[:MAX_BIN_COLUMNS]
        ],
    )


def _scale_marks(run: ScaleRun, key: str) -> tuple[Item, ...]:
    """一列上的参考线：zscore 画 μ 与 μ±σ，minmax 画压平之后的两端。

    Args: run, key。
    """
    center = run.scales[key]["center"]
    span = run.scales[key]["scale"]
    if run.method == "minmax":
        return (
            {"at": center, "label": "压到 0", "intent": "info"},
            {"at": center + span, "label": "压到 1", "intent": "info"},
        )
    return (
        {"at": center - span, "label": "z = −1", "intent": "info"},
        {"at": center, "label": "z = 0（μ）", "intent": "info"},
        {"at": center + span, "label": "z = +1", "intent": "info"},
    )


def _one_hot_columns(run: OneHotRun) -> ReportBlock:
    """原列去了哪、编出来的是哪几列。

    Args: run。
    """
    made = [
        f"{key}={category}"
        for key in run.keys
        for category in run.categories.get(key, ())
    ]
    return columns_block(
        BlockAt(zone="step", title="列 diff", port=PORT, tier=TIER_SMALL),
        ColumnChange(
            added=made,
            removed=[key for key in run.keys if key in run.categories],
            kept=len(run.result.columns),
            reason=f"{len(run.categories)} 列编成 {len(made)} 个 0/1 列",
        ),
    )


def _one_hot_breakdown(run: OneHotRun) -> ReportBlock:
    """每个类目在整帧上命中多少行，留下的排前面、砍掉的排后面。

    Args: run。
    """
    return breakdown_block(
        BlockAt(
            zone="charts",
            title="类目命中",
            port=PORT,
            tier=TIER_SMALL,
            is_primary=True,
        ),
        Scale(label="命中行数", unit="行"),
        [
            _category_item(run, key, category, count)
            for key in run.keys
            for category, count in run.ranked.get(key, ())
        ],
    )


def _category_item(run: OneHotRun, key: str, category: str, count: int) -> Item:
    """一个类目那一条：整帧命中行数、训练行频次、留没留下、编码位。

    ⚠ 命中数按整帧算、频次按训练行算：定类目用的是训练行，命中的却是每一行，
    两个数不一样才是对的。
    Args: run, key, category, count。
    """
    kept = list(run.categories.get(key, ()))
    hits = _hit_count(run.source, key, category)
    return {
        "name": f"{key}={category}",
        "value": hits,
        "spread": None,
        "ratio": ratio_of(hits, run.source.row_count),
        "fit_count": count,
        "kept": category in kept,
        "position": kept.index(category) if category in kept else None,
    }


def _one_hot_fits(run: OneHotRun, misses: Mapping[str, _Misses]) -> ReportBlock:
    """逐列：留了几个类目、砍了几个，以及一个 1 都没编出来的那些行。

    Args: run, misses。
    """
    return fits_block(
        BlockAt(zone="table", title="类目清单", port=PORT, tier=TIER_SMALL),
        method="keep_top",
        train_rows=run.train_rows,
        total_rows=run.source.row_count,
        by_column=[_one_hot_row(run, key, misses[key]) for key in run.keys],
    )


def _one_hot_row(run: OneHotRun, key: str, miss: _Misses) -> Item:
    """一列在类目清单里的那一行。

    Args: run, key, miss。
    """
    found = len(run.ranked.get(key, ()))
    kept = len(run.categories.get(key, ()))
    return {
        "key": key,
        "params": {
            "categories": found,
            "kept": kept,
            "cut": found - kept,
            "hit_rows": miss.hit,
            "unseen_rows": miss.unseen,
            "blank_rows": miss.blank,
            "unseen_ratio": ratio_of(miss.unseen, run.source.row_count),
            "blank_ratio": ratio_of(miss.blank, run.source.row_count),
        },
        "skipped_reason": "",
    }


def _select_columns(run: SelectRun) -> ReportBlock:
    """留下哪几列、淘汰哪几列，外加两条只有后端看得见的告警。

    Args: run。
    """
    block = columns_block(
        BlockAt(zone="step", title="保留与淘汰", port=PORT, tier=TIER_SMALL),
        ColumnChange(
            removed=list(run.removed),
            kept=len(run.result.columns),
            reason=(
                f"在 {run.train_rows} 行训练行上按"
                f"{SCORE_LABELS.get(run.method, run.method)}"
                f"给 {len(run.candidates)} 个候选列打分，留下前 {run.top_k} 列"
            ),
        ),
    )
    return _hinted(_flagged(block, run.is_degraded), _select_hints(run.method))


def _select_hints(method: str) -> tuple[str, ...]:
    """这一档打分自带的坑；没有坑就一个字都不说。

    Args: method。
    """
    return (VARIANCE_HINT,) if method == "variance" else ()


def _select_breakdown(run: SelectRun) -> ReportBlock:
    """打分降序，留下的实心、淘汰的空心，基准是留下来的最低分。

    ⚠ 基准取第 k 名而不是第 k+1 名：那条线画在「刚好留下」的位置上，分数断层
    看得出来的话，调 top_k 才有依据。
    Args: run。
    """
    ranked = sorted(run.candidates, key=lambda key: (-run.scores[key], key))
    kept = set(run.kept)
    return breakdown_block(
        BlockAt(
            zone="charts",
            title="打分排行",
            port=PORT,
            tier=TIER_SMALL,
            is_primary=True,
        ),
        Scale(
            label=SCORE_LABELS.get(run.method, run.method),
            baseline=_cut_score(run),
        ),
        [
            {
                "name": key,
                "value": run.scores[key],
                "spread": None,
                "kept": key in kept,
                "rank": rank + 1,
            }
            for rank, key in enumerate(ranked)
        ],
    )


def _cut_score(run: SelectRun) -> float | None:
    """留下来的那几列里最低的那个分；一列都没留下时给 `None`。

    Args: run。
    """
    scores = [run.scores[key] for key in run.kept if key in run.scores]
    return min(scores) if scores else None


def _misses_of(run: OneHotRun, key: str) -> _Misses:
    """一列上命中、未见过、本来就空的行数各是多少。

    Args: run, key。
    """
    kept = set(run.categories.get(key, ()))
    hit = 0
    blank = 0
    for value in run.source.values_of(key):
        if value is None:
            blank += 1
        elif str(value) in kept:
            hit += 1
    return _Misses(hit, run.source.row_count - hit - blank, blank)


def _hit_count(frame: Frame, key: str, category: str) -> int:
    """一个类目在整帧上命中多少行。

    Args: frame, key, category。
    """
    return sum(
        1
        for value in frame.values_of(key)
        if value is not None and str(value) == category
    )


def _four_points(values: Sequence[float | None], prefix: str) -> dict[str, Any]:
    """一列的四个点：两端、中位数与均值。一个非空值都没有时四个都给 `None`。

    Args: values, prefix。
    """
    present = [
        value for value in values if value is not None and math.isfinite(value)
    ]
    if not present:
        return {f"{prefix}_{name}": None for name in _POINTS}
    ordered = sorted(present)
    return {
        f"{prefix}_min": ordered[0],
        f"{prefix}_p50": median(ordered),
        f"{prefix}_mean": sum(ordered) / len(ordered),
        f"{prefix}_max": ordered[-1],
    }


def _present(frame: Frame, key: str) -> list[float]:
    """一列的非空取值。

    Args: frame, key。
    """
    return [value for value in numbers_of(frame, key) if value is not None]


def _present_count(frame: Frame, key: str) -> int:
    """一列有多少个非空格。

    Args: frame, key。
    """
    return len(_present(frame, key))


def _hinted(block: ReportBlock, notes: Sequence[str]) -> ReportBlock:
    """给一块挂上几行口径说明，收在小问号里。

    Args: block, notes。
    """
    return annotated(block, NOTE_HINT, notes)


def _flagged(block: ReportBlock, is_degraded: bool) -> ReportBlock:
    """给一块挂上「这一步有没有静默退化」这一对。

    ⚠ 布尔与文案一起给：界面照文案印，而「有没有退化」这个判断只有后端做得出
    ——真条件是下游切分的个数，前端沿着上游找会在没退化时乱报（规格 §11 R-12）。
    Args: block, is_degraded。
    """
    return replace(
        block,
        payload={
            **block.payload,
            "degraded": is_degraded,
            "degraded_reason": DEGRADED_REASON if is_degraded else "",
        },
    )
