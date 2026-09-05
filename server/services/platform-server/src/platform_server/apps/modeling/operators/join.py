"""多台账按时间对齐。

⚠ 两边的列名会撞——同一个「温度」在两张台账上是两回事。右侧一律加前缀，前缀
定死不给配空串：配空了就成了静默覆盖，而下游拿到的是哪一张表的数看不出来。
⚠ 对齐按**时刻就近**，不是按行号：两张台账的采集周期常常不同，按行号并起来的
每一行都是错的，而每个数看着都正常。
"""

from collections import Counter
from dataclasses import dataclass, replace
from typing import Any, Literal

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.frame import (
    CellValue,
    Frame,
    frame_input,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import (
    TIER_SCALAR,
    TIER_SMALL,
    BlockAt,
    ColumnBins,
    ColumnChange,
    Item,
    ReportBlock,
    RowCounts,
    bins_block,
    columns_block,
    rows_block,
)
from platform_server.apps.modeling.operators.steps import (
    Stage,
    column_bins,
    funnel_of,
    ratio_of,
    spread_of,
)

# 对齐容差的上限：一天。⚠ 无界的话「就近」会退化成「随便找一行」
MAX_TOLERANCE_MS = 86_400_000
# 这个算子只有一路输出，讲解全挂在它上面
PORT = "frame"
# 时刻差的箱数：容差那一段切这么细就够看出「贴着容差边缘对上的」有多少
GAP_BUCKETS = 30

type JoinHow = Literal["inner", "left"]


class LedgerJoinConfig(OperatorConfig):
    """多台账对齐的参数。"""

    how: JoinHow = Field(
        default="inner",
        title="怎么并",
        description=(
            "inner=两边都有才留；left=以左边为准，右边没有的那几列留空"
        ),
    )
    tolerance_ms: int = Field(
        default=60_000,
        ge=0,
        le=MAX_TOLERANCE_MS,
        title="对齐容差（毫秒）",
        description="两边时刻相差不超过它才算同一时刻；0 表示必须完全相等",
    )
    right_prefix: str = Field(
        default="右_",
        min_length=1,
        max_length=16,
        title="右侧列名前缀",
        description="右边每一列都加上它，避免与左边同名",
    )


@register_operator
class LedgerJoin(OperatorBase):
    """把两份数据按时刻就近并成一份。"""

    CODE = "ledger_join"
    NAME = "多台账对齐"
    DESCRIPTION = "把两份数据按时刻就近并成一份，右侧列名加前缀"
    CATEGORY = "source"
    ICON = "link"
    CONFIG_MODEL = LedgerJoinConfig
    INPUTS = (
        PortSpec(name="left", contract=CONTRACT_FRAME, label="左"),
        PortSpec(name="right", contract=CONTRACT_FRAME, label="右"),
    )
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    CHANGES_ROW_COUNT = True
    # 推理时数据由调用方逐行给，对齐这一步整个跳过
    ENABLED_IN_SERVING = False

    @property
    def _config(self) -> LedgerJoinConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, LedgerJoinConfig):  # pragma: no cover
            raise OperatorError("多台账对齐拿到了不匹配的参数")
        return self.config

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """左边原样，右边每一列加前缀。

        Args: config, inputs。
        """
        left = inputs.get("left")
        right = inputs.get("right")
        if left is None or right is None:
            return {"frame": None}
        if not isinstance(config, LedgerJoinConfig):
            return {"frame": None}
        prefix = config.right_prefix
        return {"frame": (*left, *(f"{prefix}{key}" for key in right))}

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._aligned: _Aligned | None = None

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """按时刻就近并。两边都必须带时刻。

        Args: inputs。
        """
        config = self._config
        left = frame_input(inputs, "left")
        right = frame_input(inputs, "right")
        if left.index is None or right.index is None:
            raise OperatorError("两边都要带时刻才对得齐，请检查上游的取数")
        _refuse_prefix_clashes(left, right, config.right_prefix)
        matches = _matches(left.index, right.index, config.tolerance_ms)
        frame = _joined(
            left, right, [found.position for found in matches], config
        )
        self._aligned = _Aligned(
            left=left, right=right, matches=matches, out_rows=frame.row_count
        )
        return {"frame": frame}

    def report(self) -> tuple[ReportBlock, ...]:
        """对齐的三块：三分账、并进来的列、时刻差与复用次数。"""
        aligned = self._aligned
        if aligned is None:
            return ()
        config = self._config
        return (
            _tally_block(aligned, config),
            _columns_block(aligned, config),
            _spread_block(aligned, config),
        )


@dataclass(frozen=True)
class _Match:
    """一条左行配到的右行与两者的时刻差；`position=None` = 容差内没有。"""

    position: int | None
    gap: int | None


@dataclass(frozen=True)
class _Aligned:
    """对齐这一步实际发生了什么，`report()` 照它讲。"""

    left: Frame
    right: Frame
    matches: tuple[_Match, ...]
    out_rows: int


def _refuse_prefix_clashes(left: Frame, right: Frame, prefix: str) -> None:
    """加完前缀之后仍与左边撞名就当场说清楚。

    Args: left, right, prefix。
    """
    taken = set(left.keys) & {f"{prefix}{key}" for key in right.keys}
    if taken:
        raise OperatorError(
            f"加上前缀之后仍与左边撞名：{'、'.join(sorted(taken))}，请换个前缀"
        )


def _matches(
    left: tuple[int, ...], right: tuple[int, ...], tolerance: int
) -> tuple[_Match, ...]:
    """每条左行在容差内离得最近的那条右行，连时刻差一起。

    ⚠ 双指针，不是逐行全扫：全扫是 O(左行 × 右行)，两边各五万行就是 25 亿次
    比较，而这一步在图上只是「并一下」。
    ⚠ 两边的时刻都不保证有序，故先各自按时刻排一遍再走指针。
    Args: left, right, tolerance。
    """
    first = _first_positions(right)
    moments = sorted(first)
    found = [_Match(None, None)] * len(left)
    cursor = 0
    for seat in sorted(range(len(left)), key=lambda seat: left[seat]):
        moment = left[seat]
        while cursor + 1 < len(moments) and moments[cursor + 1] <= moment:
            cursor += 1
        found[seat] = _closest(moment, moments, cursor, first, tolerance)
    return tuple(found)


def _first_positions(index: tuple[int, ...]) -> dict[int, int]:
    """每个时刻上**最靠前**的那一行的行号。

    ⚠ 同一时刻有多行时只留最靠前的那一行：不定的话同一份数据两次跑出来的行不同。
    Args: index。
    """
    first: dict[int, int] = {}
    for position, moment in enumerate(index):
        first.setdefault(moment, position)
    return first


def _closest(
    moment: int,
    moments: list[int],
    cursor: int,
    first: dict[int, int],
    tolerance: int,
) -> _Match:
    """指针左右这两个时刻里离得最近、超不出容差的那一个。

    ⚠ 一样近时取行号小的那一行——与逐行全扫的取法一致。
    Args: moment, moments, cursor, first, tolerance。
    """
    picks = [
        (abs(moments[seat] - moment), first[moments[seat]])
        for seat in (cursor, cursor + 1)
        if seat < len(moments) and abs(moments[seat] - moment) <= tolerance
    ]
    if not picks:
        return _Match(None, None)
    gap, position = min(picks)
    return _Match(position, gap)


def _joined(
    left: Frame,
    right: Frame,
    matched: list[int | None],
    config: LedgerJoinConfig,
) -> Frame:
    """按匹配结果拼出并起来的帧。

    Args: left, right, matched, config。
    """
    kept = [
        position
        for position, found in enumerate(matched)
        if found is not None or config.how == "left"
    ]
    if not kept:
        raise OperatorError(
            "按这个容差一行都对不上，请把容差放宽或检查两边的时间范围"
        )
    blanks: tuple[CellValue, ...] = tuple(None for _ in right.columns)
    rows = tuple(
        (
            *left.rows[position],
            *(
                blanks
                if matched[position] is None
                else right.rows[matched[position] or 0]
            ),
        )
        for position in kept
    )
    columns = (
        *left.columns,
        *(
            replace(column, key=f"{config.right_prefix}{column.key}")
            for column in right.columns
        ),
    )
    return replace(
        left,
        columns=columns,
        rows=rows,
        index=(
            tuple(left.index[position] for position in kept)
            if left.index is not None
            else None
        ),
    )


def _tally_block(aligned: _Aligned, config: LedgerJoinConfig) -> ReportBlock:
    """三分账：两边都有 / 左有右无 / 右侧从没被用上。

    Args: aligned, config。
    """
    rows = aligned.left.row_count
    return rows_block(
        BlockAt(zone="step", title="对齐三分账", port=PORT, tier=TIER_SCALAR),
        RowCounts(
            before=rows,
            after=aligned.out_rows,
            dropped=rows - aligned.out_rows,
            ratio_actual=ratio_of(aligned.out_rows, rows),
        ),
        funnel=funnel_of(_tally_stages(aligned, config)),
    )


def _tally_stages(
    aligned: _Aligned, config: LedgerJoinConfig
) -> tuple[Stage, ...]:
    """六级账，从两边各自的行数一路数到输出行数。

    Args: aligned, config。
    """
    rows = aligned.left.row_count
    used = {found.position for found in aligned.matches}
    hit = sum(1 for found in aligned.matches if found.position is not None)
    lonely = (
        "以左为准，右边那几列留空"
        if config.how == "left"
        else "按这个容差对不上，整行丢掉"
    )
    return (
        Stage("左表行数", rows, "行"),
        Stage("右表行数", aligned.right.row_count, "行"),
        Stage("两边都有", hit, "行"),
        Stage("左有右无", rows - hit, "行", lonely),
        Stage(
            "右侧从没被用上", aligned.right.row_count - len(used - {None}), "行"
        ),
        Stage("输出行数", aligned.out_rows, "行"),
    )


def _columns_block(aligned: _Aligned, config: LedgerJoinConfig) -> ReportBlock:
    """并进来的是右边哪几列。

    Args: aligned, config。
    """
    prefix = config.right_prefix
    return columns_block(
        BlockAt(zone="step", title="并进来的列", port=PORT, tier=TIER_SMALL),
        ColumnChange(
            added=tuple(
                f"{prefix}{column.key}" for column in aligned.right.columns
            ),
            kept=len(aligned.left.columns),
            reason=f"右边每一列都加前缀「{prefix}」，同名列不会互相盖掉",
        ),
    )


def _spread_block(aligned: _Aligned, config: LedgerJoinConfig) -> ReportBlock:
    """时刻差与右行复用次数两条分布。

    ⚠ 复用次数不是可有可无的一张图：一条右行被几十条左行命中时，这一步事实上
    做的是一次前向填充，而输出帧上一个字都看不出来。
    Args: aligned, config。
    """
    return bins_block(
        BlockAt(
            zone="charts",
            title="时刻差与右行复用次数",
            port=PORT,
            tier=TIER_SMALL,
        ),
        [_gap_bins(aligned, config), _reuse_bins(aligned)],
    )


def _gap_bins(aligned: _Aligned, config: LedgerJoinConfig) -> ColumnBins:
    """对上的那些行差了多少毫秒；没对上的落在轴外。

    Args: aligned, config。
    """
    tolerance = config.tolerance_ms
    gaps = [
        None if found.gap is None else float(found.gap)
        for found in aligned.matches
    ]
    marks: list[Item] = [
        {"at": float(tolerance), "label": "容差", "intent": "danger"}
    ]
    middle = _median_gap(gaps)
    if middle is not None:
        marks.append({"at": middle, "label": "中位差", "intent": "info"})
    return column_bins(
        "时刻差（毫秒）",
        spread_of(gaps, buckets=GAP_BUCKETS, low=0.0, high=float(tolerance)),
        off_label="超出容差没对上",
        marks=marks,
    )


def _median_gap(gaps: list[float | None]) -> float | None:
    """对上的那些时刻差的中位数；一条都没对上给 `None` 不给 0。

    Args: gaps。
    """
    found = sorted(gap for gap in gaps if gap is not None)
    return found[len(found) // 2] if found else None


def _reuse_bins(aligned: _Aligned) -> ColumnBins:
    """每条右行被几条左行命中；从没被用上的落在轴外。

    Args: aligned。
    """
    hits = Counter(
        found.position
        for found in aligned.matches
        if found.position is not None
    )
    counts = [
        None if position not in hits else float(hits[position])
        for position in range(aligned.right.row_count)
    ]
    most = max(hits.values()) if hits else 0
    return column_bins(
        "右行被命中次数",
        spread_of(counts, low=1.0, high=float(most)),
        off_label="从没被用上",
        marks=(
            {
                "at": float(most),
                "label": "最多被命中",
                "intent": "warning" if most > 1 else "info",
            },
        ),
    )
