"""描述统计、成对相关分析与固定边界分箱。"""

import bisect
import math
from dataclasses import replace
from typing import Literal, Self

from pydantic import Field, model_validator

from platform_server.apps.modeling.operators.base import (
    ColumnsByPort,
    OperatorConfig,
    OperatorError,
    column_field,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    DTYPE_STRING,
    ROLE_IGNORED,
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
)

DESCRIBE_KEYS = (
    "column",
    "count",
    "missing",
    "mean",
    "std",
    "min",
    "p25",
    "median",
    "p75",
    "max",
)
CORRELATION_KEYS = ("left_column", "right_column", "correlation", "pairs")
MAX_CORRELATION_COLUMNS = 32
DEFAULT_BOUNDARIES = (0.0, 10.0, 100.0)


class DescribeStatsConfig(OperatorConfig):
    """描述统计列与标准差口径。"""

    columns: list[str] = column_field(
        title="统计数值列",
        description="留空选择全部非目标数值列；每列输出一行统计结果",
        default_factory=list[str],
    )
    ddof: Literal["sample", "population"] = Field(
        default="sample",
        title="标准差口径",
        description="sample=样本标准差；population=总体标准差",
    )


@register_operator
class DescribeStats(FrameOperator):
    CODE = "describe_stats"
    NAME = "描述统计"
    DESCRIPTION = (
        "逐列给出有效数、缺失数、均值、标准差和四分位；无有效观测的统计值为空"
    )
    CATEGORY = "evaluate"
    ICON = "table"
    CONFIG_MODEL = DescribeStatsConfig
    CHANGES_ROW_COUNT = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        config = DescribeStatsConfig.model_validate(self.config.model_dump())
        keys = self.numeric_columns(frame, config.columns)
        columns = tuple(
            FrameColumn(
                key=key,
                name=key,
                dtype=DTYPE_STRING if key == "column" else DTYPE_NUMBER,
                role=ROLE_IGNORED if key == "column" else "feature",
            )
            for key in DESCRIBE_KEYS
        )
        rows = tuple(
            _describe(key, numbers_of(frame, key), config.ddof) for key in keys
        )
        return replace(frame, columns=columns, rows=rows, index=None)

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        del config, inputs
        return {"frame": DESCRIBE_KEYS}


def _describe(
    key: str, values: list[float | None], ddof: str
) -> tuple[CellValue, ...]:
    present = sorted(value for value in values if value is not None)
    count = len(present)
    if not present:
        return (
            key,
            0.0,
            float(len(values)),
            *(None for _ in DESCRIBE_KEYS[3:]),
        )
    mean = finite(math.fsum(value / count for value in present))
    scale = max(abs(value) for value in present)
    normalized = (
        [value / scale for value in present] if scale else [0.0] * count
    )
    center = math.fsum(normalized) / count
    divisor = count - (1 if ddof == "sample" else 0)
    std = (
        finite(
            math.sqrt(
                math.fsum((value - center) ** 2 for value in normalized)
                / divisor
            )
            * scale
        )
        if divisor > 0
        else None
    )
    return (
        key,
        float(count),
        float(len(values) - count),
        mean,
        std,
        present[0],
        _quantile(present, 0.25),
        _quantile(present, 0.5),
        _quantile(present, 0.75),
        present[-1],
    )


def _quantile(values: list[float], ratio: float) -> float | None:
    position = (len(values) - 1) * ratio
    left = int(position)
    weight = position - left
    right = min(left + 1, len(values) - 1)
    return finite(values[left] * (1 - weight) + values[right] * weight)


class CorrelationConfig(OperatorConfig):
    """成对删除缺失后的相关分析参数。"""

    columns: list[str] = column_field(
        title="相关分析数值列",
        description="最多 32 列；留空选全部非目标数值列",
        default_factory=list[str],
    )
    method: Literal["pearson", "spearman"] = Field(
        default="pearson",
        title="相关系数",
        description="pearson=线性相关；spearman=秩相关",
    )
    min_pairs: int = Field(
        default=3,
        ge=2,
        le=200_000,
        title="最少有效配对",
        description="每对列独立排除缺失；不足数量或常量列的相关系数留空",
    )


@register_operator
class Correlation(FrameOperator):
    CODE = "correlation"
    NAME = "相关分析"
    DESCRIPTION = "输出每对列的相关系数及真实有效样本量；相关不代表因果关系"
    CATEGORY = "evaluate"
    ICON = "table"
    CONFIG_MODEL = CorrelationConfig
    CHANGES_ROW_COUNT = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        config = CorrelationConfig.model_validate(self.config.model_dump())
        keys = self.numeric_columns(frame, config.columns)
        if len(keys) > MAX_CORRELATION_COLUMNS:
            raise OperatorError("相关分析最多选择 32 列，请缩小列范围")
        columns = tuple(
            FrameColumn(
                key=key,
                name=key,
                dtype=DTYPE_STRING if key.endswith("column") else DTYPE_NUMBER,
                role=ROLE_IGNORED if key.endswith("column") else "feature",
            )
            for key in CORRELATION_KEYS
        )
        values = {key: numbers_of(frame, key) for key in keys}
        rows = tuple(
            _correlation_pair(first, second, values, config)
            for seat, first in enumerate(keys)
            for second in keys[seat:]
        )
        return replace(frame, columns=columns, rows=rows, index=None)

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        del config, inputs
        return {"frame": CORRELATION_KEYS}


def _correlation_pair(
    left: str,
    right: str,
    values: dict[str, list[float | None]],
    config: CorrelationConfig,
) -> tuple[CellValue, ...]:
    pairs = [
        (first, second)
        for first, second in zip(values[left], values[right], strict=True)
        if first is not None and second is not None
    ]
    if len(pairs) < config.min_pairs:
        return (left, right, None, float(len(pairs)))
    first = [pair[0] for pair in pairs]
    second = [pair[1] for pair in pairs]
    if config.method == "spearman":
        first, second = _ranks(first), _ranks(second)
    return (left, right, _pearson(first, second), float(len(pairs)))


def _ranks(values: list[float]) -> list[float]:
    ranks = [0.0] * len(values)
    ordered = sorted(range(len(values)), key=lambda seat: values[seat])
    cursor = 0
    while cursor < len(ordered):
        end = cursor + 1
        while (
            end < len(ordered)
            and values[ordered[end]] == values[ordered[cursor]]
        ):
            end += 1
        for position in range(cursor, end):
            ranks[ordered[position]] = (cursor + 1 + end) / 2
        cursor = end
    return ranks


def _centered(values: list[float]) -> list[float]:
    scale = max(abs(value) for value in values)
    normalized = (
        [value / scale for value in values] if scale else [0.0] * len(values)
    )
    mean = math.fsum(normalized) / len(values)
    return [value - mean for value in normalized]


def _pearson(first: list[float], second: list[float]) -> float | None:
    left, right = _centered(first), _centered(second)
    divisor = math.sqrt(
        math.fsum(value * value for value in left)
        * math.fsum(value * value for value in right)
    )
    if divisor == 0:
        return None
    result = (
        math.fsum(a * b for a, b in zip(left, right, strict=True)) / divisor
    )
    return finite(max(-1.0, min(1.0, result)))


class BinningConfig(OperatorConfig):
    """由显式固定边界确定的分箱参数。"""

    columns: list[str] = column_field(
        title="分箱数值列",
        description="留空选择全部非目标数值列",
        default_factory=list[str],
    )
    boundaries: list[float] = Field(
        default_factory=lambda: list(DEFAULT_BOUNDARIES),
        min_length=1,
        max_length=100,
        title="递增分界点",
        description="严格递增；箱号从 0 开始，两端自动包含全部更小或更大值",
        json_schema_extra={"default": list(DEFAULT_BOUNDARIES)},
    )
    is_right_closed: bool = Field(
        default=True,
        title="分界点归入左侧箱",
        description="开启时边界值归入左侧箱，关闭时归入右侧箱",
    )
    suffix: str = Field(
        default="_bin", min_length=1, max_length=32, title="输出列名后缀"
    )

    @model_validator(mode="after")
    def ordered_boundaries(self) -> Self:
        if any(
            right <= left
            for left, right in zip(
                self.boundaries, self.boundaries[1:], strict=False
            )
        ):
            raise ValueError("分界点必须严格递增且不能重复")
        return self


@register_operator
class Binning(FrameOperator):
    CODE = "binning"
    NAME = "固定边界分箱"
    DESCRIPTION = "使用显式边界生成数值箱号，不从测试数据学习阈值；空值保持为空"
    CATEGORY = "feature"
    ICON = "ruler"
    CONFIG_MODEL = BinningConfig
    ENABLED_IN_SERVING = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        config = BinningConfig.model_validate(self.config.model_dump())
        keys = self.numeric_columns(frame, config.columns)
        locate = (
            bisect.bisect_left
            if config.is_right_closed
            else bisect.bisect_right
        )
        columns = [
            FrameColumn(
                key=f"{key}{config.suffix}",
                name=f"{frame.column_of(key).name}（箱号）",
                dtype=DTYPE_NUMBER,
            )
            for key in keys
        ]
        values = [
            [
                (
                    None
                    if value is None
                    else float(locate(config.boundaries, value))
                )
                for value in numbers_of(frame, key)
            ]
            for key in keys
        ]
        return appended(frame, columns, values)

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        parsed = BinningConfig.model_validate(config.model_dump())
        source = inputs.get("frame")
        return {
            "frame": (
                None
                if source is None or not parsed.columns
                else (
                    *source,
                    *(f"{key}{parsed.suffix}" for key in parsed.columns),
                )
            )
        }
