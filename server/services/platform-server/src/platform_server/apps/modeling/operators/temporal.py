"""历史时间平移与周期时间编码；预测输入口径见 docs/MODELING_DESIGN.md。"""

import math
from dataclasses import replace
from datetime import timedelta
from itertools import pairwise
from typing import Literal, Self

from pydantic import Field, model_validator

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.frame import (
    Frame,
    FrameColumn,
    frame_input,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import (
    BlockAt,
    ColumnChange,
    ReportBlock,
    Scale,
    breakdown_block,
    columns_block,
)

MINUTE_MS = 60_000
DAY_MINUTES = 1440
WEEK_MINUTES = 7 * DAY_MINUTES
EPOCH_WEEKDAY = 3  # 1970-01-01，周四


class TimeShiftConfig(OperatorConfig):
    """把历史观测移到未来目标时刻的参数。"""

    offset_minutes: int = Field(
        default=DAY_MINUTES,
        ge=1,
        le=30 * DAY_MINUTES,
        strict=True,
        title="向后平移（分钟）",
        description="1440 为昨日同时刻，10080 为上周同时刻；接精确时间对齐算子",
    )


@register_operator
class TimeShift(OperatorBase):
    """平移历史数据的时间索引，供下游按目标时刻对齐。"""

    CODE = "time_shift"
    NAME = "历史时间平移"
    DESCRIPTION = (
        "将历史观测向后平移，再精确关联到预测时刻；发布后须提供对应历史值"
    )
    CATEGORY = "preprocess"
    ICON = "calendar"
    CONFIG_MODEL = TimeShiftConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="历史"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="平移后"),)
    ENABLED_IN_SERVING = False

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._shift = TimeShiftConfig.model_validate(config.model_dump())
        self._rows: int | None = None

    def run(self, inputs: dict[str, object]) -> dict[str, Frame]:
        """保持数值与列序，只移动唯一递增的时刻。Args: inputs。"""
        frame = frame_input(inputs, "frame")
        index = _time_index(frame)
        if any(right <= left for left, right in pairwise(index)):
            raise OperatorError("历史时刻必须严格递增且唯一，请先按时间重采样")
        offset = self._shift.offset_minutes
        delta = timedelta(minutes=offset)
        provenance = frame.provenance
        try:
            shifted = replace(
                provenance,
                since=(
                    None
                    if provenance.since is None
                    else provenance.since + delta
                ),
                until=(
                    None
                    if provenance.until is None
                    else provenance.until + delta
                ),
                observed_until=(
                    None
                    if provenance.observed_until is None
                    else provenance.observed_until + delta
                ),
            )
        except OverflowError as error:
            raise OperatorError("平移后的时间超出可支持范围") from error
        self._rows = frame.row_count
        return {
            "frame": replace(
                frame,
                index=tuple(moment + offset * MINUTE_MS for moment in index),
                provenance=shifted,
            )
        }

    def report(self) -> tuple[ReportBlock, ...]:
        if self._rows is None:
            return ()
        return (
            breakdown_block(
                BlockAt(zone="step", title="历史时间对齐口径", port="frame"),
                Scale(label="向后平移", unit="分钟"),
                [
                    {
                        "key": "offset",
                        "label": "历史观测向后平移",
                        "value": self._shift.offset_minutes,
                    }
                ],
            ),
        )


type Cycle = Literal["day", "week"]


class CyclicTimeConfig(OperatorConfig):
    """日内和周内正余弦编码的参数。"""

    cycles: list[Cycle] = Field(
        default_factory=lambda: ["day", "week"],
        min_length=1,
        max_length=2,
        title="周期",
        description="day=日内周期；week=周内周期",
    )
    timezone_offset_minutes: int = Field(
        default=480,
        ge=-840,
        le=840,
        strict=True,
        title="业务时区相对 UTC 的分钟偏移",
        description="中国为 480；固定偏移随模型发布保存，训练与预测保持一致",
    )

    @model_validator(mode="after")
    def unique_cycles(self) -> Self:
        if len(self.cycles) != len(set(self.cycles)):
            raise ValueError("周期不能重复")
        return self


@register_operator
class CyclicTime(OperatorBase):
    """将目标时刻编码为连续的日内、周内正余弦特征。"""

    CODE = "cyclic_time"
    NAME = "周期时间特征"
    DESCRIPTION = "按目标时刻生成日内、周内正余弦；预测时必须提供时刻"
    CATEGORY = "feature"
    ICON = "calendar"
    CONFIG_MODEL = CyclicTimeConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    SERVING_NEEDS_INDEX = True

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._cyclic = CyclicTimeConfig.model_validate(config.model_dump())
        self._change: ColumnChange | None = None

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        given = inputs.get("frame")
        parsed = CyclicTimeConfig.model_validate(config.model_dump())
        return {
            "frame": None if given is None else (*given, *_cycle_keys(parsed))
        }

    def run(self, inputs: dict[str, object]) -> dict[str, Frame]:
        """从每行时刻编码周期，保留已有行与元信息。Args: inputs。"""
        frame = frame_input(inputs, "frame")
        index = _time_index(frame)
        config = self._cyclic
        keys = _cycle_keys(config)
        if set(keys) & set(frame.keys):
            raise OperatorError("周期特征列已存在，请先移除同名列")
        columns = (
            *frame.columns,
            *(FrameColumn(key=key, name=key, dtype="number") for key in keys),
        )
        rows = tuple(
            (*row, *_cycle_values(moment, config))
            for row, moment in zip(frame.rows, index, strict=True)
        )
        self._change = ColumnChange(
            added=keys,
            kept=len(columns),
            reason=(
                f"固定 UTC 偏移 {config.timezone_offset_minutes} 分钟，"
                "预测时沿用"
            ),
        )
        return {"frame": replace(frame, columns=columns, rows=rows)}

    def report(self) -> tuple[ReportBlock, ...]:
        if self._change is None:
            return ()
        return (
            columns_block(
                BlockAt(zone="step", title="周期时间编码", port="frame"),
                self._change,
            ),
        )


def _time_index(frame: Frame) -> tuple[int, ...]:
    if frame.index is None:
        raise OperatorError("这份数据没有时刻，请提供时间索引")
    if len(frame.index) != frame.row_count:
        raise OperatorError("时间索引长度与数据行数不一致")
    return frame.index


def _cycle_keys(config: CyclicTimeConfig) -> tuple[str, ...]:
    return tuple(
        f"ts_{cycle}_{part}"
        for cycle in config.cycles
        for part in ("sin", "cos")
    )


def _cycle_values(moment: int, config: CyclicTimeConfig) -> tuple[float, ...]:
    minutes = moment / MINUTE_MS + config.timezone_offset_minutes
    values: list[float] = []
    for cycle in config.cycles:
        period = DAY_MINUTES if cycle == "day" else WEEK_MINUTES
        shifted = (
            minutes if cycle == "day" else minutes + EPOCH_WEEKDAY * DAY_MINUTES
        )
        angle = math.tau * (shifted % period) / period
        values.extend((math.sin(angle), math.cos(angle)))
    return tuple(values)
