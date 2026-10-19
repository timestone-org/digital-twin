"""时间重采样算子：把行按时间桶合并成更粗的粒度。

单独成一个模块，是因为它是清洗那几个里**唯一看时间轴**的：桶宽、业务时区对齐、
以及那张必须与台账同集合的八档聚合表，都只服务它一个。
"""

from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Annotated, Any, Literal

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    CellValue,
    Frame,
    FrameColumn,
    frame_input,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import (
    TIER_LARGE,
    TIER_SCALAR,
    TIER_SMALL,
    BlockAt,
    Item,
    ReportBlock,
    RowCounts,
    TimeAxis,
    axis_block,
    bins_block,
    rows_block,
)
from platform_server.apps.modeling.operators.steps import (
    Stage,
    axis_span,
    column_bins,
    funnel_of,
    moment_text,
    ratio_of,
    spread_of,
)

# 时间桶的宽度，毫秒。⚠ 只给闭合的几档，不收「随便一个毫秒数」：那会让用户配出
# 与台账对不上的桶宽，而两边各自看着都对
_BUCKET_MS: dict[str, int] = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "6h": 21_600_000,
    "1d": 86_400_000,
}
type BucketWidth = Literal["1m", "5m", "15m", "30m", "1h", "6h", "1d"]

# 聚合口径。⚠ **与台账那八档同集合**，由契约用例钉住：两边漂了的表现是
# 「台账里按小时看是一个数、建模里按小时取是另一个数」
type AggFunc = Literal[
    "avg", "count", "delta", "first", "last", "max", "min", "sum"
]
AGG_FUNCS: tuple[str, ...] = (
    "avg",
    "count",
    "delta",
    "first",
    "last",
    "max",
    "min",
    "sum",
)

# 一分钟的毫秒数，把时区偏移折成毫秒用
_MINUTE_MS = 60_000

# 这个算子只有一路输出，讲解全挂在它上面
PORT = "frame"
# 每桶行数那张图上，警示线画在「一桶只有一行」这个位置
_SINGLE_ROW = 1.0
# 每桶行数那条分布不属于任何一列，用这个名字当它的列名
BUCKET_SIZE_KEY = "每桶行数"
# 一行都没进来时，桶的账算不出来
NOTE_NO_ROWS = "一行都没进来，切不出桶"


class ResampleConfig(OperatorConfig):
    """时间重采样的参数。"""

    bucket: BucketWidth = Field(
        default="1h",
        title="桶宽",
        description="1m=一分钟；5m=五分钟；15m=十五分钟；30m=半小时；1h=一小时；"
        "6h=六小时；1d=一天",
    )
    agg: AggFunc = Field(
        default="avg",
        title="怎么聚",
        description=(
            "avg=平均；count=非空个数；delta=末值减初值；first=桶内第一个；"
            "last=桶内最后一个；max=最大；min=最小；sum=求和"
        ),
    )
    column_aggregations: dict[Annotated[str, Field(min_length=1)], AggFunc] = (
        Field(
            default_factory=dict,
            max_length=256,
            title="各列的汇总方式",
            description=(
                "avg=平均；count=非空个数；delta=末值减初值；first=桶内第一个；"
                "last=桶内最后一个；max=最大；min=最小；sum=求和"
            ),
            json_schema_extra={
                "x-dt-widget": "column-aggregations",
                "default": {},
            },
        )
    )
    missing_policy: Literal["ignore", "propagate"] = Field(
        default="ignore",
        title="桶内有缺失值时",
        description="ignore=只用非空值汇总；propagate=该列该桶保持空值，避免把部分能耗当全天总量",
    )
    should_keep_complete_buckets: bool = Field(
        default=False,
        title="只保留完整时间桶",
        description="只保留查询窗口完整覆盖的桶，排除首尾半天；取数触顶或没有窗口时停止",
    )


@register_operator
class Resample(OperatorBase):
    """把行按时间桶合并。

    ⚠ 桶按**业务时区**对齐，不按 UTC：按 UTC 切「一天」在东八区会整体偏 8 小时，
    而算出来的数看着完全正常。
    ⚠ 空桶不补行：一段没有数据的时间就是没有数据，凭空造一行会把「没测到」变成
    一个真实取值。
    ⚠ 非数值列一律取桶内**最后一个**取值——平均 / 求和这些对文本没有意义。
    """

    CODE = "resample"
    NAME = "时间重采样"
    DESCRIPTION = "把行按时间桶合并成更粗的粒度"
    CATEGORY = "preprocess"
    ICON = "calendar"
    CONFIG_MODEL = ResampleConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    CHANGES_ROW_COUNT = True
    # 推理时只有一行，没有可合并的桶
    ENABLED_IN_SERVING = False

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._folding: _Folding | None = None

    @property
    def _config(self) -> ResampleConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, ResampleConfig):  # pragma: no cover
            raise OperatorError("时间重采样拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """按桶合并。没有时间索引就说清楚，不按行号硬分。

        Args: inputs。
        """
        frame = frame_input(inputs, "frame")
        if frame.index is None:
            raise OperatorError(
                "这份数据没有时间索引，重采样无从下手——"
                "请把取数那一步的行来源改成带时刻的那一档"
            )
        buckets = _buckets_of(
            frame.index, self._config.bucket, self.tz_offset_minutes
        )
        _check_aggregations(frame, self._config)
        buckets = _complete_buckets(frame, buckets, self._config)
        folded = _merged(frame, buckets, self._config)
        self._folding = _Folding(
            row_count=frame.row_count,
            starts=tuple(start for start, _ in buckets),
            sizes=tuple(len(positions) for _, positions in buckets),
        )
        return {"frame": folded}

    def report(self) -> tuple[ReportBlock, ...]:
        """重采样的三块：压缩比、桶占用与断档、每桶行数。"""
        folding = self._folding
        if folding is None:
            return ()
        width = _BUCKET_MS[self._config.bucket]
        return (
            _rows_block(folding, width),
            _axis_block(folding, width, self.tz_offset_minutes),
            _sizes_block(folding),
        )


@dataclass(frozen=True)
class _Folding:
    """这一步把多少行折进了哪些桶，`report()` 照它讲。"""

    #: 进来多少行
    row_count: int
    #: 每个桶的起点，升序
    starts: tuple[int, ...]
    #: 与 `starts` 同序的每桶行数
    sizes: tuple[int, ...]

    @property
    def excluded_rows(self) -> int:
        return self.row_count - sum(self.sizes)


def _rows_block(folding: _Folding, width: int) -> ReportBlock:
    """压缩比：多少行折成多少行。

    ⚠ 只把完整桶筛选排除的行记为丢弃，合并进桶的行不算丢弃。
    Args: folding, width。
    """
    after = len(folding.starts)
    return rows_block(
        BlockAt(zone="step", title="压缩比", port=PORT, tier=TIER_SCALAR),
        RowCounts(
            before=folding.row_count,
            after=after,
            dropped=folding.excluded_rows,
            ratio_actual=ratio_of(after, folding.row_count),
        ),
        funnel=funnel_of(_bucket_stages(folding, width)),
    )


def _bucket_stages(folding: _Folding, width: int) -> tuple[Stage, ...]:
    """进来多少行 → 这一段横跨几个桶 → 其中几个有数据 → 几个是空的。

    Args: folding, width。
    """
    occupied = len(folding.starts)
    span = _span_of(folding.starts, width)
    note = "" if span is not None else NOTE_NO_ROWS
    return (
        Stage("输入行", folding.row_count, "行"),
        *(
            (Stage("排除不完整桶后", sum(folding.sizes), "行"),)
            if folding.excluded_rows
            else ()
        ),
        Stage("时段内的桶", span, "个", note),
        Stage("有数据的桶", occupied, "个"),
        Stage("空桶", None if span is None else span - occupied, "个", note),
    )


def _span_of(starts: tuple[int, ...], width: int) -> int | None:
    """首尾两个桶之间一共横跨几个桶；一个桶都没有时给 `None`。

    Args: starts, width。
    """
    if not starts:
        return None
    return (starts[-1] - starts[0]) // width + 1


def _axis_block(
    folding: _Folding, width: int, tz_offset_minutes: int
) -> ReportBlock:
    """桶占用与断档，桶宽与时区一并说清。

    ⚠ 时区必须跟着桶宽一起讲：按 UTC 与按东八区切出来的两条轴长得一模一样，
    而每一格里的数差了 8 小时。
    Args: folding, width, tz_offset_minutes。
    """
    starts = folding.starts
    span = axis_span(starts)
    return axis_block(
        BlockAt(
            zone="charts",
            title="桶占用与断档",
            port=PORT,
            tier=TIER_LARGE,
            is_primary=True,
        ),
        TimeAxis(
            bucket_ms=width,
            tz_offset_minutes=tz_offset_minutes,
            actual_since=moment_text(starts[0]) if starts else None,
            actual_until=moment_text(starts[-1]) if starts else None,
            occupancy=span.occupancy,
            gaps=span.gaps,
        ),
    )


def _sizes_block(folding: _Folding) -> ReportBlock:
    """每桶行数的分布，有单行桶时在那一柱上画一条警示线。

    ⚠ 没有单行桶就不画那条线：无条件画的话，「1 那一柱是空的」与「这段数据里
    压根没有单行桶」在图上长得一模一样。
    Args: folding。
    """
    singles = sum(1 for size in folding.sizes if size == 1)
    marks: tuple[Item, ...] = (
        ()
        if singles == 0
        else (
            {
                "at": _SINGLE_ROW,
                "label": f"单行桶 {singles} 个",
                "intent": "warning",
            },
        )
    )
    spread = spread_of([float(size) for size in folding.sizes])
    return bins_block(
        BlockAt(
            zone="charts",
            title="每桶行数",
            port=PORT,
            tier=TIER_SMALL,
            is_primary=False,
        ),
        [column_bins(BUCKET_SIZE_KEY, spread, marks=marks)],
    )


def _buckets_of(
    index: tuple[int, ...], bucket: BucketWidth, tz_offset_minutes: int
) -> list[tuple[int, list[int]]]:
    """`[(桶起点, 落在这个桶里的行下标)]`，按桶起点升序。

    ⚠ 先加时区偏移再取整、再减回去：直接对 UTC 毫秒取整，「一天」的边界会落在
    当地时间早上八点上。
    Args: index, bucket, tz_offset_minutes。
    """
    width = _BUCKET_MS[bucket]
    offset = tz_offset_minutes * _MINUTE_MS
    grouped: dict[int, list[int]] = {}
    for position, moment in enumerate(index):
        start = ((moment + offset) // width) * width - offset
        grouped.setdefault(start, []).append(position)
    return sorted(grouped.items())


def _merged(
    frame: Frame, buckets: list[tuple[int, list[int]]], config: ResampleConfig
) -> Frame:
    """把每个桶折成一行。

    Args: frame, buckets, config。
    """
    methods: list[AggFunc] = [
        _column_method(column, config) for column in frame.columns
    ]
    rows = tuple(
        tuple(
            _column_value(
                column,
                [frame.rows[at][position] for at in positions],
                methods[position],
                config.missing_policy,
            )
            for position, column in enumerate(frame.columns)
        )
        for _, positions in buckets
    )
    columns = tuple(
        (
            replace(column, dtype=DTYPE_NUMBER, unit="")
            if method == "count"
            else column
        )
        for column, method in zip(frame.columns, methods, strict=True)
    )
    return replace(
        frame,
        columns=columns,
        rows=rows,
        index=tuple(start for start, _ in buckets),
    )


def _check_aggregations(frame: Frame, config: ResampleConfig) -> None:
    """显式配置的列必须存在且支持该聚合。Args: frame, config。"""
    for key, method in config.column_aggregations.items():
        column = frame.column_of(key)
        if column.dtype != DTYPE_NUMBER and method not in (
            "first",
            "last",
            "count",
        ):
            raise OperatorError(
                f"列「{key}」不是数值列，只能取首值、末值或计数"
            )


def _column_method(column: FrameColumn, config: ResampleConfig) -> AggFunc:
    return config.column_aggregations.get(
        column.key, config.agg if column.dtype == DTYPE_NUMBER else "last"
    )


def _column_value(
    column: FrameColumn,
    values: list[CellValue],
    method: AggFunc,
    missing_policy: str,
) -> CellValue:
    """按一列的汇总及缺失口径折算。

    Args: column, values, method, missing_policy。
    """
    if missing_policy == "propagate" and any(value is None for value in values):
        return None
    if method == "count":
        return float(sum(value is not None for value in values))
    if column.dtype != DTYPE_NUMBER and method == "first":
        return next((value for value in values if value is not None), None)
    return _aggregated(column, values, method)


def _complete_buckets(
    frame: Frame, buckets: list[tuple[int, list[int]]], config: ResampleConfig
) -> list[tuple[int, list[int]]]:
    """仅保留查询范围完整覆盖的桶。Args: frame, buckets, config。"""
    if not config.should_keep_complete_buckets:
        return buckets
    source = frame.provenance
    if source.is_truncated:
        raise OperatorError(
            "取数达到行数上限，无法确认完整时间桶；请缩小取数窗口或提高行数上限"
        )
    if source.since is None or source.until is None:
        raise OperatorError("完整时间桶需要明确的取数起止窗口")
    since = source.since.timestamp() * 1000
    until = (
        min(source.until, source.observed_until or source.until).timestamp()
        * 1000
    )
    width = _BUCKET_MS[config.bucket]
    return [
        (start, positions)
        for start, positions in buckets
        if since <= start and start + width <= until
    ]


def _aggregated(
    column: FrameColumn, values: list[CellValue], agg: AggFunc
) -> CellValue:
    """一个桶里的一列折成一个值。

    ⚠ 取值由调用方按列下标取好：列下标在这里查的话，每桶每列都要把列定义扫
    一遍，宽表上是几千万次线性查找。
    Args: column, values, agg。
    """
    if column.dtype != DTYPE_NUMBER:
        return _last_present(values)
    numbers = [
        float(value)
        for value in values
        if isinstance(value, (int | float)) and not isinstance(value, bool)
    ]
    if agg == "count":
        return float(len(numbers))
    if not numbers:
        return None
    return _folded(numbers, agg)


# 八档聚合各自怎么折。⚠ 写成一张表而不是一串 if：加一档时只多一行，
# 而漏掉哪一档在登记那一刻就由「表的键 = 取值集合」那条用例逮到
_FOLDERS: dict[str, Callable[[list[float]], float]] = {
    "avg": lambda values: sum(values) / len(values),
    "sum": sum,
    "min": min,
    "max": max,
    "first": lambda values: values[0],
    "last": lambda values: values[-1],
    "delta": lambda values: values[-1] - values[0],
}


def _folded(numbers: list[float], agg: AggFunc) -> float:
    """一桶数值按口径折成一个数。

    Args: numbers, agg。
    """
    return _FOLDERS[agg](numbers)


def _last_present(values: list[CellValue]) -> CellValue:
    """桶内最后一个非空取值；全空就是空。

    Args: values。
    """
    for value in reversed(values):
        if value is not None:
            return value
    return None
