"""三个清洗算子的讲解算料：转不动的格、丢行归因、判据列的分布。

⚠ 与算子本体分开是行数的账：`cleaning.py` 贴着模块上限，算料留在那里的话下一次
谁都改不动（docs/MODELING_RESULT_VIEW_DESIGN.md §8.1）。
⚠ 只依赖帧与块，**不 import `cleaning.py`**：参数由算子那侧摊成标量传进来，反过
来 import 会成环。
"""

from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass

from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    CellValue,
    Frame,
    null_ratio_of,
    numbers_of,
)
from platform_server.apps.modeling.operators.reporting import (
    MAX_SAMPLES,
    NOTE_HINT,
    TIER_LARGE,
    TIER_SCALAR,
    TIER_SMALL,
    BlockAt,
    CellChange,
    ColumnBins,
    ColumnChange,
    Item,
    ReportBlock,
    RowCounts,
    annotated,
    bins_block,
    cells_block,
    columns_block,
    rows_block,
)
from platform_server.apps.modeling.operators.steps import (
    Spread,
    Stage,
    by_column,
    column_bins,
    dropped_bins,
    dtype_changes,
    funnel_of,
    ratio_of,
    samples_of,
    spread_of,
)

# 三个算子都只有一路输出，讲解全挂在它上面
PORT = "frame"
# 空值率留这么多位小数：再多的位数在图上一个像素都换不来
NULL_RATIO_DIGITS = 6
# 空值在数轴上没有位置。⚠ 少了这一根离轴柱，同屏的行数账就对不上（§11 R-18）
OFF_AXIS_BLANK = "空值（不在这条轴上）"
# 转不动时的两种处置，写给人看
CAST_FATE: dict[str, str] = {"coerce": "当成空值放过", "error": "当场报错"}
CAST_TARGET: dict[str, str] = {
    "number": "数值",
    "bool": "真假",
    "string": "文本",
}
# 空值在两类判据下的去向。⚠ 拿空值当 0 去比会把「没测到」变成「测到 0」
NOTE_BLANK_COMPARED = "比较档一律丢弃，不拿它当 0 去比"
NOTE_BLANK_JUDGED = "这一档专判空值，空与不空各有去向"
NOTE_HOLED_ANY = "判据列里有一个空就丢这行"
NOTE_HOLED_ALL = "判据列全空才丢这行"
# 空值率那一块没发时，好消息改落成第一区的一句话。⚠ 与零行的帧上「算不出来」
# 分开说（规格 §2-P5）：那一档是数据根本没进来，空不空无从谈起
NOTE_NO_BLANK = "{columns} 列 {rows} 行，一格空值都没有"
NOTE_CAST_NO_BLANK = "{columns} 列 {rows} 行，转前转后一格空值都没有"


@dataclass(frozen=True)
class Failed:
    """一列上转不动的格数与前几个原值。"""

    count: int
    samples: tuple[CellValue, ...]


@dataclass(frozen=True)
class Blame:
    """被丢的行里逐列各空了多少格，以及判据列全空的整行有多少。"""

    counts: Mapping[str, int]
    all_blank: int


@dataclass(frozen=True)
class CastRun:
    """类型归一实际动了什么，讲解照它讲。"""

    before: Frame
    after: Frame
    #: 处理过的列 → 那一列转不动的格
    failed: Mapping[str, Failed]
    target: str
    on_error: str


@dataclass(frozen=True)
class HoledRun:
    """丢行档实际丢了什么。"""

    before: Frame
    after: Frame
    #: 判据看的那几列
    watched: tuple[str, ...]
    blame: Blame
    #: 判据是「有一个空就丢」而不是「全空才丢」
    is_any: bool


@dataclass(frozen=True)
class EmptyRun:
    """丢列档实际丢了什么。"""

    before: Frame
    after: Frame
    #: 每一列的空值率，与判据用的是同一个函数
    ratios: Mapping[str, float]
    removed: tuple[str, ...]
    limit: float


@dataclass(frozen=True)
class FilterRun:
    """条件过滤实际筛掉了什么。"""

    before: Frame
    after: Frame
    column: str
    #: 判据列上一共有多少个空值
    blanks: int
    #: 其中因空值被丢掉的行数。⚠ 必须由后端数：前端拿「上游空值率 × 行数」推的
    #: 话，摘要在第 60 列处截断时读不到这一列，会把「读不到」画成「0 行」
    #: （规格 §11 的 R-14）
    dropped_blank: int
    threshold: float
    #: 判据是 is_blank / not_blank 这两档之一
    is_blank_judge: bool


def failed_of(values: Sequence[CellValue], cast: Sequence[CellValue]) -> Failed:
    """转不动的格：原来有值、转完成了空。

    Args: values, cast。
    """
    lost = [
        origin
        for origin, got in zip(values, cast, strict=True)
        if origin is not None and got is None
    ]
    return Failed(len(lost), tuple(lost[:MAX_SAMPLES]))


def blame_of(frame: Frame, keys: Sequence[str], kept: Collection[int]) -> Blame:
    """被丢的行里逐列数空格，顺带数出判据列全空的整行。

    Args: frame, keys, kept。
    """
    positions = [frame.position_of(key) for key in keys]
    counts = dict.fromkeys(keys, 0)
    whole = 0
    for index, row in enumerate(frame.rows):
        if index in kept:
            continue
        blanks = [
            key
            for key, seat in zip(keys, positions, strict=True)
            if row[seat] is None
        ]
        for key in blanks:
            counts[key] += 1
        if len(blanks) == len(keys):
            whole += 1
    return Blame(counts, whole)


def cast_blocks(run: CastRun) -> tuple[ReportBlock, ...]:
    """类型归一的三块：转不动的格、类型对照、空值率前后。

    ⚠ 转前转后一格空值都没有时最后那一块不发：几根柱全是 0，一排零高的横条
    说不出任何事（规格 §2-P5）。那件事是好消息，落成类型对照上的一句话。
    Args: run。
    """
    broken = _cast_cells_block(run)
    named = _cast_columns_block(run)
    spread = _cast_bins_block(run)
    if spread is not None:
        return (broken, named, spread)
    note = NOTE_CAST_NO_BLANK.format(
        columns=len(run.failed), rows=run.before.row_count
    )
    return (broken, _hinted(named, note))


def holed_blocks(run: HoledRun) -> tuple[ReportBlock, ...]:
    """丢行档的两块：行数账带归因、判据列各自的空值率。

    ⚠ 判据列一格空值都没有时后一块不发：「哪几列空得最多」这个问题在没有空值
    时根本不存在，几根零高的柱只是占版面（规格 §2-P5）。
    Args: run。
    """
    counted = _holed_rows_block(run)
    spread = _holed_bins_block(run)
    if spread is not None:
        return (counted, spread)
    note = NOTE_NO_BLANK.format(
        columns=len(run.watched), rows=run.before.row_count
    )
    return (_hinted(counted, note),)


def empty_blocks(run: EmptyRun) -> tuple[ReportBlock, ...]:
    """丢列档的三块：列数账、丢掉的是谁、各列空值率对着那条阈值线。

    ⚠ 一格空值都没有时最后那一块不发：每列一根零高的柱贴着那条阈值线，说的是
    零（规格 §2-P5）。那件事是好消息，落成列数账上的一句话。
    Args: run。
    """
    counted = _empty_rows_block(run)
    named = _empty_columns_block(run)
    spread = _empty_bins_block(run)
    if spread is not None:
        return (counted, named, spread)
    note = NOTE_NO_BLANK.format(
        columns=len(run.ratios), rows=run.before.row_count
    )
    return (_hinted(counted, note), named)


def filter_blocks(run: FilterRun) -> tuple[ReportBlock, ...]:
    """条件过滤的两块：行数账（含因空丢弃）、判据列的分布与那条阈值线。

    ⚠ 非数值列画不出分布，那一块整个不讲——画一张空图会被读成「这一列全是空」。
    Args: run。
    """
    counted = (_filter_rows_block(run),)
    spread = _filter_bins_block(run)
    return counted if spread is None else (*counted, spread)


def _cast_cells_block(run: CastRun) -> ReportBlock:
    """转不动的那些格，多的排前面，各带几个原值。

    ⚠ 原值是这一块唯一买不回来的东西：只报个数的话，用户分不出坏的是 `--` 这类
    占位符，还是整列都填错了单位。
    Args: run。
    """
    ranked = sorted(
        (key for key, found in run.failed.items() if found.count > 0),
        key=lambda key: (-run.failed[key].count, key),
    )
    return cells_block(
        BlockAt(zone="step", title="转不动的格", port=PORT, tier=TIER_SMALL),
        [
            CellChange(
                key=key,
                changed=run.failed[key].count,
                samples=samples_of(run.failed[key].samples),
            )
            for key in ranked
        ],
    )


def _cast_columns_block(run: CastRun) -> ReportBlock:
    """逐列的类型前后对照，只列真的换过的那几列。

    Args: run。
    """
    return columns_block(
        BlockAt(zone="step", title="类型对照", port=PORT, tier=TIER_SCALAR),
        ColumnChange(
            kept=len(run.after.columns),
            dtype_before=dtype_changes(_dtypes(run.before), _dtypes(run.after)),
            reason=(
                f"{len(run.failed)} 列转成{CAST_TARGET[run.target]}，"
                f"转不动的{CAST_FATE[run.on_error]}"
            ),
        ),
    )


def _cast_bins_block(run: CastRun) -> ReportBlock | None:
    """每列空值率的转前转后两根柱；两边都没有空值时不发。

    ⚠ 行数不变，两根柱共用同一个分母，故差值可信——这是全步唯一一处直接比得出
    「转坏了多少」的地方。
    Args: run。
    """
    rows = run.before.row_count
    ranked = sorted(run.failed, key=lambda key: (-run.failed[key].count, key))
    paired = {
        key: (
            _rounded(null_ratio_of(run.before, key), rows),
            _rounded(null_ratio_of(run.after, key), rows),
        )
        for key in ranked
    }
    if _is_all_zero(one for pair in paired.values() for one in pair):
        return None
    return bins_block(
        BlockAt(
            zone="charts",
            title="空值率前后",
            port=PORT,
            tier=TIER_SMALL,
            is_primary=True,
        ),
        [_ratio_bins(key, paired[key]) for key in ranked],
    )


def _holed_rows_block(run: HoledRun) -> ReportBlock:
    """丢了多少行、其中判据列全空的有多少、以及谁的锅。

    ⚠ 归因逐列各记各的：`any` 档一行可能同时缺好几列，几列的占比加起来会超过
    100%，那正是「这几列一起烂」的样子。
    Args: run。
    """
    before = run.before.row_count
    after = run.after.row_count
    return rows_block(
        BlockAt(zone="step", title="丢缺失", port=PORT, tier=TIER_SCALAR),
        RowCounts(
            before=before,
            after=after,
            dropped=before - after,
            dropped_blank=run.blame.all_blank,
            ratio_actual=ratio_of(after, before),
        ),
        funnel=funnel_of(
            (
                Stage("进来", before, "行"),
                Stage(
                    "被判缺失",
                    before - after,
                    "行",
                    NOTE_HOLED_ANY if run.is_any else NOTE_HOLED_ALL,
                ),
                Stage("留下", after, "行"),
            )
        ),
        by_column=by_column(run.blame.counts, whole=before - after),
    )


def _holed_bins_block(run: HoledRun) -> ReportBlock | None:
    """判据看的那几列各有多高的空值率，最空的排前面；全是零时不发。

    Args: run。
    """
    rows = run.before.row_count
    ratios = {key: null_ratio_of(run.before, key) for key in run.watched}
    ranked = sorted(ratios, key=lambda key: (-ratios[key], key))
    if _is_all_zero(_rounded(ratios[key], rows) for key in ranked):
        return None
    return bins_block(
        BlockAt(
            zone="charts",
            title="判据列的空值率",
            port=PORT,
            tier=TIER_SMALL,
            is_primary=True,
        ),
        [_ratio_bins(key, (_rounded(ratios[key], rows),)) for key in ranked],
    )


def _empty_rows_block(run: EmptyRun) -> ReportBlock:
    """这一档一行都不丢，账记在列上。

    ⚠ `ratio_actual` 是**留下来的列里最空的那一个**：与配的那条线摆在一起，才
    看得出「阈值再调低 0.1 会连哪一列也一起丢掉」。
    Args: run。
    """
    rows = run.before.row_count
    gone = set(run.removed)
    kept = [key for key in run.ratios if key not in gone]
    peak = max((run.ratios[key] for key in kept), default=None)
    return rows_block(
        BlockAt(zone="step", title="丢空列", port=PORT, tier=TIER_SCALAR),
        RowCounts(
            before=rows,
            after=rows,
            ratio_configured=run.limit,
            ratio_actual=None if peak is None else _rounded(peak, rows),
        ),
        funnel=funnel_of(
            (
                Stage("进来", len(run.ratios), "列"),
                Stage("空值率超过阈值", len(run.removed), "列"),
                Stage("留下", len(kept), "列"),
            )
        ),
    )


def _empty_columns_block(run: EmptyRun) -> ReportBlock:
    """被丢掉的是哪几列，以及那条线画在哪。

    Args: run。
    """
    return columns_block(
        BlockAt(zone="step", title="丢掉的列", port=PORT, tier=TIER_SMALL),
        ColumnChange(
            removed=run.removed,
            kept=len(run.after.columns),
            reason=f"空值率超过 {run.limit} 的列被丢掉",
        ),
    )


def _empty_bins_block(run: EmptyRun) -> ReportBlock | None:
    """各列空值率对着那条阈值线，最空的排前面；全是零时不发。

    ⚠ 只画得下前几列（`MAX_BIN_COLUMNS`）：最空的排前面，那条线两边的邻居才落
    得进画面。
    Args: run。
    """
    rows = run.before.row_count
    mark: Item = {"at": run.limit, "label": "阈值", "intent": "danger"}
    ranked = sorted(run.ratios, key=lambda key: (-run.ratios[key], key))
    if _is_all_zero(_rounded(run.ratios[key], rows) for key in ranked):
        return None
    return bins_block(
        BlockAt(
            zone="charts",
            title="各列空值率",
            port=PORT,
            tier=TIER_SMALL,
            is_primary=True,
        ),
        [
            _ratio_bins(key, (_rounded(run.ratios[key], rows),), (mark,))
            for key in ranked
        ],
    )


def _filter_rows_block(run: FilterRun) -> ReportBlock:
    """留了多少、丢了多少、其中因空值被丢的有多少。

    Args: run。
    """
    before = run.before.row_count
    after = run.after.row_count
    return rows_block(
        BlockAt(zone="step", title="条件过滤", port=PORT, tier=TIER_SCALAR),
        RowCounts(
            before=before,
            after=after,
            dropped=before - after,
            dropped_blank=run.dropped_blank,
            ratio_actual=ratio_of(after, before),
        ),
        funnel=funnel_of(
            (
                Stage("进来", before, "行"),
                Stage("空值", run.blanks, "行", _blank_note(run)),
                Stage("不合条件", before - after - run.dropped_blank, "行"),
                Stage("留下", after, "行"),
            )
        ),
    )


def _blank_note(run: FilterRun) -> str:
    """空值在这一档判据下的去向。

    Args: run。
    """
    return NOTE_BLANK_JUDGED if run.is_blank_judge else NOTE_BLANK_COMPARED


def _filter_bins_block(run: FilterRun) -> ReportBlock | None:
    """判据列的分布，阈值一条竖线，空值单独一根离轴柱。

    ⚠ 离轴柱不能省：因空值被丢的行在数轴上没有位置，缺了它同屏的行数账对不上
    （规格 §11 的 R-18）。
    Args: run。
    """
    if run.before.column_of(run.column).dtype != DTYPE_NUMBER:
        return None
    marks: tuple[Item, ...] = (
        ()
        if run.is_blank_judge
        else ({"at": run.threshold, "label": "阈值", "intent": "danger"},)
    )
    before = spread_of(numbers_of(run.before, run.column))
    return bins_block(
        BlockAt(
            zone="charts",
            title="判据列的分布",
            port=PORT,
            tier=TIER_LARGE,
            is_primary=True,
        ),
        [
            column_bins(
                run.column,
                before,
                off_label=OFF_AXIS_BLANK,
                marks=marks,
                dropped=_filter_dropped(run, before),
            )
        ],
    )


def _filter_dropped(run: FilterRun, before: Spread) -> list[float]:
    """逐桶被这一步筛掉的行数：同一条轴上，进来的减留下的。

    ⚠ 留下的那份必须按**进来那条轴**铺（两端与桶数都照抄），各自定界的话两份
    桶宽不同，逐桶相减减的是两条不同的轴。
    Args: run, before。
    """
    after = spread_of(
        numbers_of(run.after, run.column),
        buckets=len(before.counts),
        low=before.low,
        high=before.high,
    )
    return dropped_bins(before, after)


def _dtypes(frame: Frame) -> dict[str, str]:
    """列 key → 这一列现在是什么类型。

    Args: frame。
    """
    return {column.key: column.dtype for column in frame.columns}


def _rounded(ratio: float, rows: int) -> float | None:
    """空值率印到图上的样子；零行的帧给 `None` 不给 0。

    ⚠ `null_ratio_of` 在零行的帧上给 0，而那是「算不出来」不是「一个空都没有」
    （规格 §2-P4）。
    Args: ratio, rows。
    """
    return None if rows <= 0 else round(ratio, NULL_RATIO_DIGITS)


def _is_all_zero(ratios: Iterable[float | None]) -> bool:
    """这几个空值率是不是全都货真价实地等于零。

    ⚠ 算不出来的那几个（零行的帧）不算数：那一档是「数据根本没进来」，与「真
    的一格空值都没有」措辞与位置都不同，合并了就分不出（规格 §2-P5）。
    Args: ratios。
    """
    found = list(ratios)
    return bool(found) and all(ratio == 0 for ratio in found)


def _hinted(block: ReportBlock, note: str) -> ReportBlock:
    """给一块挂上一句口径说明。

    Args: block, note。
    """
    return annotated(block, NOTE_HINT, (note,))


def _ratio_bins(
    key: str, ratios: Sequence[float | None], marks: Sequence[Item] = ()
) -> ColumnBins:
    """空值率画在 0–1 那条轴上；算不出来的一根柱都不画。

    ⚠ 不画而不是画成 0：零行的帧上空值率是「算不出来」，画成 0 就成了「一个空
    都没有」（规格 §2-P4）。同一次调用里的几个数出自同一份帧，故要么全画得出、
    要么全画不出。
    Args: key, ratios, marks。
    """
    return ColumnBins(
        key=key,
        bins=[ratio for ratio in ratios if ratio is not None],
        low=0.0,
        high=1.0,
        marks=marks,
    )
