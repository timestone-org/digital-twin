"""时间重采样算子：把行按时间桶合并成更粗的粒度。

单独成一个模块，是因为它是清洗那几个里**唯一看时间轴**的：桶宽、业务时区对齐、
以及那张必须与台账同集合的八档聚合表，都只服务它一个。
"""

from collections.abc import Callable
from dataclasses import replace
from typing import Any, Literal

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

# 时间桶的宽度，毫秒。⚠ 只给闭合的几档，不收「随便一个毫秒数」：那会让用户配出
# 与台账对不上的桶宽，而两边各自看着都对
_BUCKET_MS: dict[str, int] = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "6h": 21_600_000,
    "1d": 86_400_000,
}
type BucketWidth = Literal["1m", "5m", "15m", "1h", "6h", "1d"]

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


class ResampleConfig(OperatorConfig):
    """时间重采样的参数。"""

    bucket: BucketWidth = Field(
        default="1h",
        title="桶宽",
        description="1m=一分钟；5m=五分钟；15m=十五分钟；1h=一小时；"
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
        return {"frame": _merged(frame, buckets, self._config.agg)}


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
    frame: Frame, buckets: list[tuple[int, list[int]]], agg: AggFunc
) -> Frame:
    """把每个桶折成一行。

    Args: frame, buckets, agg。
    """
    rows = tuple(
        tuple(
            _aggregated(frame, column, positions, agg)
            for column in frame.columns
        )
        for _, positions in buckets
    )
    return replace(frame, rows=rows, index=tuple(start for start, _ in buckets))


def _aggregated(
    frame: Frame,
    column: FrameColumn,
    positions: list[int],
    agg: AggFunc,
) -> CellValue:
    """一个桶里的一列折成一个值。

    Args: frame, column, positions, agg。
    """
    values = [
        frame.rows[position][frame.position_of(column.key)]
        for position in positions
    ]
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
