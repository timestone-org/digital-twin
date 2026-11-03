"""有序差分、累计统计与组内排名。"""

from collections import defaultdict
from itertools import pairwise
from typing import Literal

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    ColumnsByPort,
    OperatorConfig,
    OperatorError,
    column_field,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    CellValue,
    Frame,
    FrameColumn,
    frame_input,
    numbers_of,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.tabular import (
    FrameOperator,
    appended,
    finite,
    selected_keys,
)


def _ordered(frame: Frame) -> None:
    if frame.index is not None and any(
        right <= left for left, right in pairwise(frame.index)
    ):
        raise OperatorError(
            "时间索引必须严格递增且唯一，请先排序并处理重复时刻"
        )


class DifferenceConfig(OperatorConfig):
    """按行间隔计算差分或增长率。"""

    columns: list[str] = column_field(
        title="计算数值列",
        description="留空选择全部非目标数值列；有时间索引时要求严格递增",
        default_factory=list[str],
    )
    method: Literal["difference", "pct_change", "ratio"] = Field(
        default="difference",
        title="计算方式",
        description="difference=本行减前值；pct_change=增长率百分数；ratio=本行除以前值",
    )
    periods: int = Field(
        default=1,
        ge=1,
        le=10_000,
        title="向前间隔行数",
        description="按观测行数计算，不假设时间采样间隔固定",
    )
    suffix: str = Field(
        default="_change", min_length=1, max_length=32, title="输出列名后缀"
    )
    on_zero: Literal["null", "error"] = Field(
        default="null",
        title="前值为零时",
        description="null=增长率和比值留空；error=停止并报错",
        json_schema_extra={
            "x-dt-visible-when": {"method": ["pct_change", "ratio"]}
        },
    )


@register_operator
class Difference(FrameOperator):
    CODE = "difference"
    NAME = "差分与增长率"
    DESCRIPTION = "按有序观测计算变化；不足间隔或任一值缺失时保持为空"
    CATEGORY = "feature"
    ICON = "ruler"
    CONFIG_MODEL = DifferenceConfig
    SERVING_NEEDS_WINDOW = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        _ordered(frame)
        config = DifferenceConfig.model_validate(self.config.model_dump())
        keys = self.numeric_columns(frame, config.columns)
        columns = [
            _derived(
                frame,
                key,
                config.suffix,
                (
                    ""
                    if config.method != "difference"
                    else frame.column_of(key).unit
                ),
            )
            for key in keys
        ]
        values = [_differences(numbers_of(frame, key), config) for key in keys]
        return appended(frame, columns, values)

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        parsed = DifferenceConfig.model_validate(config.model_dump())
        return _derived_keys(inputs, parsed.columns, parsed.suffix)


def _differences(
    values: list[float | None], config: DifferenceConfig
) -> list[CellValue]:
    result: list[CellValue] = []
    for seat, current in enumerate(values):
        previous = (
            values[seat - config.periods] if seat >= config.periods else None
        )
        if current is None or previous is None:
            result.append(None)
        elif config.method == "difference":
            result.append(finite(current - previous))
        else:
            result.append(_relative_change(current, previous, config))
    return result


def _relative_change(
    current: float, previous: float, config: DifferenceConfig
) -> float | None:
    if previous == 0:
        if config.on_zero == "error":
            raise OperatorError("增长率或比值的前值为零")
        return None
    ratio = current / previous
    return finite((ratio - 1) * 100 if config.method == "pct_change" else ratio)


class CumulativeStatsConfig(OperatorConfig):
    """沿当前行序的累计统计参数。"""

    columns: list[str] = column_field(
        title="累计数值列",
        description="留空选择全部非目标数值列；有时间索引时要求严格递增",
        default_factory=list[str],
    )
    method: Literal["sum", "mean", "min", "max"] = Field(
        default="sum",
        title="累计统计",
        description="sum=累计和；mean=累计平均；min=累计最小；max=累计最大",
    )
    missing_policy: Literal["skip", "propagate"] = Field(
        default="skip",
        title="遇到缺失时",
        description="skip=该行留空，后续继续累计有效值；propagate=该行及后续结果均留空",
    )
    suffix: str = Field(
        default="_cumulative", min_length=1, max_length=32, title="输出列名后缀"
    )


@register_operator
class CumulativeStats(FrameOperator):
    CODE = "cumulative_stats"
    NAME = "累计统计"
    DESCRIPTION = "从首行向后累计有效观测，不使用未来数据；缺失行不伪造读数"
    CATEGORY = "feature"
    ICON = "ruler"
    CONFIG_MODEL = CumulativeStatsConfig
    SERVING_NEEDS_WINDOW = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        _ordered(frame)
        config = CumulativeStatsConfig.model_validate(self.config.model_dump())
        keys = self.numeric_columns(frame, config.columns)
        columns = [
            _derived(frame, key, config.suffix, frame.column_of(key).unit)
            for key in keys
        ]
        return appended(
            frame,
            columns,
            [_cumulative(numbers_of(frame, key), config) for key in keys],
        )

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        parsed = CumulativeStatsConfig.model_validate(config.model_dump())
        return _derived_keys(inputs, parsed.columns, parsed.suffix)


def _cumulative(
    values: list[float | None], config: CumulativeStatsConfig
) -> list[CellValue]:
    output: list[CellValue] = []
    total: float | None = None
    count = 0
    poisoned = False
    for value in values:
        if value is None or poisoned:
            output.append(None)
            poisoned = poisoned or config.missing_policy == "propagate"
            continue
        count += 1
        if total is None:
            total = value
        else:
            total = _next_cumulative(total, value, count, config.method)
        output.append(total)
    return output


def _next_cumulative(
    total: float, value: float, count: int, method: str
) -> float | None:
    if method == "sum":
        return finite(total + value)
    if method == "mean":
        return finite(total * ((count - 1) / count) + value / count)
    if method == "min":
        return min(total, value)
    return max(total, value)


def _derived(frame: Frame, key: str, suffix: str, unit: str) -> FrameColumn:
    return FrameColumn(
        key=f"{key}{suffix}",
        name=f"{frame.column_of(key).name}{suffix}",
        dtype=DTYPE_NUMBER,
        unit=unit,
    )


def _derived_keys(
    inputs: ColumnsByPort, keys: list[str], suffix: str
) -> ColumnsByPort:
    source = inputs.get("frame")
    return {
        "frame": (
            None
            if source is None or not keys
            else (*source, *(f"{key}{suffix}" for key in keys))
        )
    }


class RankRowsConfig(OperatorConfig):
    """明确分组和并列规则的排名参数。"""

    column: str = column_field(title="排名数值列")
    group_columns: list[str] = column_field(
        title="组内排名依据",
        description="留空在全部输入行中排名；空值归为同一组",
        default_factory=list[str],
    )
    method: Literal["average", "min", "dense", "ordinal"] = Field(
        default="average",
        title="并列名次处理",
        description="average=并列名次取平均；min=取最小名次；dense=并列后名次连续；ordinal=相同值按原行序排不同名次",
    )
    is_ascending: bool = Field(default=False, title="数值越小排名越前")
    output_column: str = Field(
        default="rank", min_length=1, max_length=128, title="输出列名"
    )


@register_operator
class RankRows(FrameOperator):
    CODE = "rank_rows"
    NAME = "分组排名"
    DESCRIPTION = (
        "按整份输入或分组排名并保留行序；空值不参与排名，适用于统计分析"
    )
    CATEGORY = "feature"
    ICON = "list-checks"
    CONFIG_MODEL = RankRowsConfig
    SERVING_NEEDS_WINDOW = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        config = RankRowsConfig.model_validate(self.config.model_dump())
        values = numbers_of(frame, config.column)
        if config.group_columns:
            selected_keys(frame, config.group_columns)
        positions = [frame.position_of(key) for key in config.group_columns]
        groups: dict[tuple[CellValue, ...], list[int]] = defaultdict(list)
        for seat, row in enumerate(frame.rows):
            if values[seat] is not None:
                groups[tuple(row[position] for position in positions)].append(
                    seat
                )
        ranks: list[CellValue] = [None] * frame.row_count
        for seats in groups.values():
            _rank_group(seats, values, ranks, config)
        return appended(
            frame,
            [
                FrameColumn(
                    key=config.output_column,
                    name=config.output_column,
                    dtype=DTYPE_NUMBER,
                )
            ],
            [ranks],
        )

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        parsed = RankRowsConfig.model_validate(config.model_dump())
        source = inputs.get("frame")
        return {
            "frame": None if source is None else (*source, parsed.output_column)
        }


def _rank_group(
    seats: list[int],
    values: list[float | None],
    ranks: list[CellValue],
    config: RankRowsConfig,
) -> None:
    ordered = sorted(
        seats,
        key=lambda seat: _rank_value(values[seat]),
        reverse=not config.is_ascending,
    )
    cursor = 0
    dense = 0
    while cursor < len(ordered):
        end = cursor + 1
        while (
            end < len(ordered)
            and values[ordered[end]] == values[ordered[cursor]]
        ):
            end += 1
        dense += 1
        rank = (
            (cursor + 1 + end) / 2
            if config.method == "average"
            else float(dense if config.method == "dense" else cursor + 1)
        )
        for position in range(cursor, end):
            ranks[ordered[position]] = (
                float(position + 1) if config.method == "ordinal" else rank
            )
        cursor = end


def _rank_value(value: float | None) -> float:
    return value if value is not None else 0.0
