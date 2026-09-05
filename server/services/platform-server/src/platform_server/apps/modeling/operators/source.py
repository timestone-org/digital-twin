"""数据源算子：从数据台账取一段数据变成特征帧。

⚠ 取数本身**不在算子里**：算子跑在没有数据库连接的子进程里，帧由引擎在事件
循环侧预取好，经保留输入键交进来（docs/MODELING_DESIGN.md §3.3、D17b）。
算子在这里的职责是声明参数 schema——引擎正是照它去取数的。
"""

from dataclasses import dataclass
from typing import Any, Literal

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    PREFETCHED_KEY,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
    moment_field,
    table_field,
)
from platform_server.apps.modeling.operators.frame import (
    Frame,
    FrameColumn,
    Provenance,
    empty_keys,
    without_columns,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import (
    MAX_BIN_COLUMNS,
    TIER_LARGE,
    TIER_SCALAR,
    TIER_SMALL,
    BlockAt,
    ColumnBins,
    ColumnChange,
    Item,
    ReportBlock,
    RowCounts,
    TimeAxis,
    axis_block,
    bins_block,
    columns_block,
    rows_block,
)
from platform_server.apps.modeling.operators.steps import (
    Stage,
    axis_span,
    funnel_of,
    moment_text,
)

# 一次取数的行上限。硬顶与运行参数里的 MAX_SOURCE_ROWS 同量级，两者取小
MAX_ROW_LIMIT = 200_000
DEFAULT_ROW_LIMIT = 50_000

# 这个算子只有一路输出，讲解全挂在它上面
PORT = "frame"
# 台账当前一共几列、窗口里究竟命中几行——取数只把结果交进来，这两个数没跟着
# 回来。⚠ 拿手里这一份的数去顶替就成了假账（规格 §2-P4）
NOTE_LEDGER_COLUMNS = "只点名取了几列，台账当前一共几列没跟着交进来"
NOTE_WINDOW_HIT = "触顶了，窗口里究竟命中多少行没跟着交进来"

# 行来源。⚠ 只有采集行走桶身份、同一时刻至多一行；manual/import 的同一时刻
# 合法地有多行，选 `all` 时时间索引不再唯一（§3.3）
type RowSource = Literal["collect", "manual", "import", "all"]


class LedgerSourceConfig(OperatorConfig):
    """台账取数的参数。"""

    table_code: str = table_field(
        title="数据台账", description="从哪张台账取数"
    )
    columns: list[str] = Field(
        default_factory=list[str],
        title="取哪些列",
        description="留空表示取当前全部列",
        json_schema_extra={"x-dt-widget": "column"},
    )
    since: str = moment_field(
        default="-90d",
        title="起始时刻",
        description="绝对时刻，或相对写法如 -90d / -12h",
    )
    until: str = moment_field(
        default="",
        title="截止时刻",
        description="留空表示取到此刻",
    )
    row_source: RowSource = Field(
        default="collect",
        title="行来源",
        description=(
            "collect=按周期聚合出来的行；manual=人工录入；import=导入；"
            "all=全要（同一时刻可能有多行）"
        ),
    )
    row_limit: int = Field(
        default=DEFAULT_ROW_LIMIT,
        ge=1,
        le=MAX_ROW_LIMIT,
        title="行数上限",
        description="取最新的这么多行；触顶会在运行记录与界面上如实标注",
    )
    should_drop_empty_columns: bool = Field(
        default=False,
        title="丢掉整列全空的列",
        description=(
            "打开后，在这段时间里一个值都没有的列不再往下走。"
            "下游若显式引用了被丢掉的列，会在那一步报「没有这一列」"
        ),
    )


@register_operator
class LedgerSource(OperatorBase):
    """从数据台账取一段数据。"""

    CODE = "ledger_source"
    NAME = "台账取数"
    DESCRIPTION = "从一张数据台账按时间范围取行，得到一份等宽的特征帧"
    CATEGORY = "source"
    ICON = "table"
    CONFIG_MODEL = LedgerSourceConfig
    OUTPUTS = (
        PortSpec(
            name="frame",
            contract=CONTRACT_FRAME,
            label="数据",
            description="取到的等宽矩阵，缺失保留为空",
        ),
    )
    # 推理时数据由调用方逐行给，取数这一步整个跳过
    ENABLED_IN_SERVING = False

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._taken: _Taken | None = None

    @property
    def _config(self) -> LedgerSourceConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, LedgerSourceConfig):  # pragma: no cover
            raise OperatorError("台账取数拿到了不匹配的参数")
        return self.config

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """列来自参数里挑的那几列；留空表示取全部，静态推不出来。

        ⚠ 这是个**上界**而不是等式：`should_drop_empty_columns` 开着时，整列全空
        的列会在运行时被丢掉。所以发布期那道「声明 = 实测」的核对只查推理链上的
        步骤，取数不在其中（它 `ENABLED_IN_SERVING=False`）。
        Args: config, inputs。
        """
        del inputs
        picked = (
            config.columns if isinstance(config, LedgerSourceConfig) else []
        )
        return {"frame": tuple(picked) if picked else None}

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """把引擎预取好的帧交出去，必要时先丢掉整列全空的列。

        Args: inputs。
        """
        frame = inputs.get(PREFETCHED_KEY)
        if not isinstance(frame, Frame):
            raise OperatorError("引擎没有为取数节点准备数据")
        if not frame.columns:
            raise OperatorError("这张台账当前一列都没有，取不出数据")
        empty = empty_keys(frame)
        if not self._config.should_drop_empty_columns:
            self._taken = _Taken(source=frame, kept=frame, empty=empty)
            return {"frame": frame}
        kept = without_columns(frame, empty)
        if not kept.columns:
            raise OperatorError("这段时间里每一列都是空值，没有列能往下走")
        self._taken = _Taken(source=frame, kept=kept, empty=empty)
        return {"frame": kept}

    def report(self) -> tuple[ReportBlock, ...]:
        """取数的四块：漏斗、丢空列、时间覆盖、各列空值率与转坏格数。"""
        taken = self._taken
        if taken is None:
            return ()
        blocks = (
            _funnel_block(taken, self._config),
            _empty_columns_block(taken, self._config),
            _quality_block(taken),
        )
        axis = _axis_block(taken, self.tz_offset_minutes)
        return blocks if axis is None else (*blocks, axis)


@dataclass(frozen=True)
class _Taken:
    """取数这一步实际拿到了什么，`report()` 照它讲。"""

    #: 引擎交进来的那一份
    source: Frame
    #: 往下走的那一份；没开丢空列时与 `source` 是同一个
    kept: Frame
    #: 整列全空的列，不论丢没丢
    empty: tuple[str, ...]


def _funnel_block(taken: _Taken, config: LedgerSourceConfig) -> ReportBlock:
    """三级列收窄接三级行收窄。

    Args: taken, config。
    """
    rows = taken.kept.row_count
    return rows_block(
        BlockAt(zone="step", title="取数漏斗", port=PORT, tier=TIER_SCALAR),
        RowCounts(before=rows, after=rows),
        funnel=funnel_of(
            (*_column_stages(taken, config), *_row_stages(taken, config))
        ),
    )


def _column_stages(
    taken: _Taken, config: LedgerSourceConfig
) -> tuple[Stage, ...]:
    """台账多少列 → 选中几列 → 丢空列后剩几列。

    Args: taken, config。
    """
    picked = len(taken.source.columns)
    total = None if config.columns else picked
    return (
        Stage(
            "台账列数",
            total,
            "列",
            "" if total is not None else NOTE_LEDGER_COLUMNS,
        ),
        Stage("选中", picked, "列"),
        Stage("丢空列后", len(taken.kept.columns), "列"),
    )


def _row_stages(taken: _Taken, config: LedgerSourceConfig) -> tuple[Stage, ...]:
    """窗口命中多少行 → 上限多少 → 实取多少。

    Args: taken, config。
    """
    rows = taken.kept.row_count
    hit = None if taken.source.provenance.is_truncated else rows
    return (
        Stage(
            "窗口命中",
            hit,
            "行",
            "" if hit is not None else NOTE_WINDOW_HIT,
        ),
        Stage("行数上限", config.row_limit, "行"),
        Stage("实取", rows, "行"),
    )


def _empty_columns_block(
    taken: _Taken, config: LedgerSourceConfig
) -> ReportBlock:
    """整列全空的那几列，丢了的与留着的说法不同。

    Args: taken, config。
    """
    dropped = taken.empty if config.should_drop_empty_columns else ()
    return columns_block(
        BlockAt(zone="step", title="丢空列", port=PORT, tier=TIER_SCALAR),
        ColumnChange(
            removed=dropped,
            kept=len(taken.kept.columns),
            reason=_empty_reason(taken.empty, bool(dropped)),
        ),
    )


def _empty_reason(empty: tuple[str, ...], is_dropped: bool) -> str:
    """丢空列这一档到底发生了什么。

    Args: empty, is_dropped。
    """
    if is_dropped:
        return "这段时间里一个值都没有"
    if empty:
        return f"有 {len(empty)} 列整列全空，按配置留着了"
    return ""


def _axis_block(taken: _Taken, tz_offset_minutes: int) -> ReportBlock | None:
    """时间覆盖：实际取到的那一段、断档、以及请求的那一段。

    Args: taken, tz_offset_minutes。
    """
    index = taken.kept.index
    if not index:
        return None
    span = axis_span(index)
    return axis_block(
        BlockAt(zone="charts", title="时间覆盖", port=PORT, tier=TIER_LARGE),
        TimeAxis(
            tz_offset_minutes=tz_offset_minutes,
            actual_since=moment_text(min(index)),
            actual_until=moment_text(max(index)),
            occupancy=span.occupancy,
            gaps=span.gaps,
            segments=_requested(taken.source.provenance),
        ),
    )


def _requested(source: Provenance) -> tuple[Item, ...]:
    """请求的那一段。

    ⚠ 与实际取到的那一段分开印：触顶时留下的是**最新**那批，实际起点比请求的
    起点晚得多，只印一个的话出处那行字是假的（规格 §1.3 的 D-7）。
    Args: source。
    """
    if source.since is None or source.until is None:
        return ()
    return (
        {
            "since": int(source.since.timestamp() * 1000),
            "until": int(source.until.timestamp() * 1000),
            "label": "请求区间",
            "tone": "requested",
        },
    )


def _quality_block(taken: _Taken) -> ReportBlock:
    """空的格最多的那几列，转坏的格单独一段。

    Args: taken。
    """
    frame = taken.kept
    counted = [
        (column, sum(1 for row in frame.rows if row[position] is None))
        for position, column in enumerate(frame.columns)
    ]
    counted.sort(
        key=lambda pair: (-pair[1] - pair[0].coerce_failed, pair[0].key)
    )
    return bins_block(
        BlockAt(
            zone="charts",
            title="空的格最多的几列",
            port=PORT,
            tier=TIER_SMALL,
        ),
        [
            _column_quality(column, nulls, frame.row_count)
            for column, nulls in counted[:MAX_BIN_COLUMNS]
        ],
    )


def _column_quality(column: FrameColumn, nulls: int, total: int) -> ColumnBins:
    """一列的空格与转坏格，两段分开。

    ⚠ 转坏的格与空的格分开数：台账 values_json 里的类型不可信，转不动的格被当
    成缺失（`frame.py` 的 `coerce_failed`）。两者合成一个空值率之后，用户会去查
    采集为什么没上来，而真因是这一列的类型配错了。
    ⚠ 转坏格数是取数那一刻记下的，行少了它不跟着少，故先夹回空格数以内。
    Args: column, nulls, total。
    """
    bad = min(column.coerce_failed, nulls)
    return ColumnBins(
        key=column.key,
        bins=[float(nulls - bad), float(bad)] if total > 0 else [],
        low=0.0,
        high=float(total),
        marks=(
            ()
            if total <= 0
            else ({"at": total / 2, "label": "一半", "intent": "danger"},)
        ),
        off_axis=None if nulls <= 0 else {"label": "空的格", "count": nulls},
    )
