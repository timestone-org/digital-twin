"""按业务列分组汇总，空值保持显式语义。"""

import math
from collections.abc import Callable
from dataclasses import replace
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
    frame_input,
    numbers_of,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.tabular import (
    FrameOperator,
    check_capacity,
    finite,
    selected_keys,
)

type GroupAgg = Literal["avg", "sum", "min", "max", "count", "first", "last"]


class GroupAggregateConfig(OperatorConfig):
    """分组键、度量与统一汇总口径。"""

    group_columns: list[str] = column_field(
        title="分组列",
        description="留空汇总成一行；空值分组会保留",
        default_factory=list[str],
    )
    columns: list[str] = column_field(
        title="汇总数值列",
        description="留空处理分组列以外的全部数值列",
        default_factory=list[str],
    )
    agg: GroupAgg = Field(
        default="sum",
        title="汇总方式",
        description="avg=平均；sum=求和；min=最小；max=最大；count=非空个数；first=第一个非空值；last=最后一个非空值",
    )
    max_groups: int = Field(
        default=10_000,
        ge=1,
        le=200_000,
        title="最大分组数",
        description="超过上限明确报错，不截断分组",
    )


@register_operator
class GroupAggregate(FrameOperator):
    CODE = "group_aggregate"
    NAME = "分组汇总"
    DESCRIPTION = "按业务分类汇总数值列；全空度量保持为空，计数返回真实数量"
    CATEGORY = "preprocess"
    ICON = "table"
    CONFIG_MODEL = GroupAggregateConfig
    CHANGES_ROW_COUNT = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        config = GroupAggregateConfig.model_validate(self.config.model_dump())
        groups = _group_positions(frame, config)
        by = tuple(config.group_columns)
        keys = _measure_keys(frame, config)
        measures = {key: numbers_of(frame, key) for key in keys}
        columns = tuple(frame.column_of(key) for key in by) + tuple(
            replace(
                frame.column_of(key),
                key=f"{key}_{config.agg}",
                name=f"{frame.column_of(key).name}（{config.agg}）",
                unit="" if config.agg == "count" else frame.column_of(key).unit,
            )
            for key in keys
        )
        if len({column.key for column in columns}) != len(columns):
            raise OperatorError("汇总输出列名与分组列重复，请先调整输入列名")
        check_capacity(len(groups), columns)
        rows = tuple(
            (
                *signature,
                *(
                    _aggregate(
                        [measures[key][seat] for seat in seats], config.agg
                    )
                    for key in keys
                ),
            )
            for signature, seats in groups.items()
        )
        return replace(frame, columns=columns, rows=rows, index=None)

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        del inputs
        parsed = GroupAggregateConfig.model_validate(config.model_dump())
        if not parsed.columns:
            return {"frame": None}
        return {
            "frame": (
                *parsed.group_columns,
                *(f"{key}_{parsed.agg}" for key in parsed.columns),
            )
        }


def _measure_keys(
    frame: Frame, config: GroupAggregateConfig
) -> tuple[str, ...]:
    keys = tuple(config.columns) or tuple(
        column.key
        for column in frame.columns
        if column.dtype == DTYPE_NUMBER
        and column.key not in config.group_columns
    )
    selected = selected_keys(frame, keys, is_numeric=True)
    if set(selected) & set(config.group_columns):
        raise OperatorError("分组列不能同时作为汇总列")
    return selected


def _group_positions(
    frame: Frame, config: GroupAggregateConfig
) -> dict[tuple[CellValue, ...], list[int]]:
    if config.group_columns:
        selected_keys(frame, config.group_columns)
    positions = [frame.position_of(key) for key in config.group_columns]
    grouped: dict[tuple[CellValue, ...], list[int]] = (
        {} if positions else {(): []}
    )
    for seat, row in enumerate(frame.rows):
        signature = tuple(row[position] for position in positions)
        grouped.setdefault(signature, []).append(seat)
        if len(grouped) > config.max_groups:
            raise OperatorError(
                "分组数超过配置上限，请减少分组列或缩小数据范围"
            )
    return grouped


def _aggregate(values: list[float | None], method: GroupAgg) -> float | None:
    present = [value for value in values if value is not None]
    if method == "count":
        return float(len(present))
    if not present:
        return None
    if method == "avg":
        return finite(math.fsum(value / len(present) for value in present))
    if method == "sum":
        try:
            return finite(math.fsum(present))
        except OverflowError as error:
            raise OperatorError("分组求和超出数值范围") from error
    operations: dict[str, Callable[[list[float]], float]] = {
        "min": min,
        "max": max,
        "first": lambda items: items[0],
        "last": lambda items: items[-1],
    }
    return operations[method](present)
