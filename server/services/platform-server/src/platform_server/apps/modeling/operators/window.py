"""要看历史窗口的特征：滞后与滚动统计。

⚠ 这两个会让**整条流水线不可服务**（`SERVING_NEEDS_WINDOW`）：推理时只有一行，
拿这一行去算「三期之前的值」或「近十期均值」，算出来的东西与训练时完全不是一
回事，而每一列看着都正常（docs/MODELING_DESIGN.md §7.6）。训练与评估照常，只是
发布时会明说这条线上不了。
⚠ 两个都按帧的**行序**算，而取数是按时刻正序给的。中间插了会改行序的算子就不对
了——图校验拦不住这一条，界面上要在算子说明里讲清楚。
"""

import math
from dataclasses import replace
from typing import Any, Literal

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
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

# 造出来的列名接法：`原列名@lag3` / `原列名@mean5`
FEATURE_JOINER = "@"
# 滞后期数与窗口宽度的上限。⚠ 无界的话一列能造出几千列
MAX_LAG = 100
MAX_WINDOW = 500

type RollingStat = Literal["mean", "sum", "min", "max", "std"]
ROLLING_STATS: tuple[str, ...] = ("max", "mean", "min", "std", "sum")


class LagFeatureConfig(OperatorConfig):
    """滞后特征的参数。"""

    columns: list[str] = column_field(
        title="哪几列",
        description="留空表示一列都不做",
        default_factory=list[str],
    )
    lags: list[int] = Field(
        default_factory=lambda: [1],
        min_length=1,
        title="滞后几期",
        description="每一期造一列；1 就是上一行的值",
    )


@register_operator
class LagFeature(OperatorBase):
    """把每一列前若干行的值搬到当前行上。

    ⚠ 前几行没有那么多历史，那几格是**空值**——不是 0。填 0 会把「还没有历史」
    说成「历史上是 0」，而模型学到的是后者。
    """

    CODE = "lag_feature"
    NAME = "滞后特征"
    DESCRIPTION = "把每一列前若干行的取值搬到当前行上"
    CATEGORY = "feature"
    ICON = "trending-up"
    CONFIG_MODEL = LagFeatureConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    SERVING_NEEDS_WINDOW = True

    @property
    def _config(self) -> LagFeatureConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, LagFeatureConfig):  # pragma: no cover
            raise OperatorError("滞后特征拿到了不匹配的参数")
        return self.config

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """原有的列全留着，后面接上造出来的那几列。

        Args: config, inputs。
        """
        given = inputs.get("frame")
        if given is None or not isinstance(config, LagFeatureConfig):
            return {"frame": None}
        return {"frame": (*given, *_lag_keys(config))}

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """按行序往前取值。

        Args: inputs。
        """
        config = self._config
        frame = frame_input(inputs, "frame")
        _refuse_clashes(frame, _lag_keys(config))
        made = [
            (
                f"{key}{FEATURE_JOINER}lag{lag}",
                _shifted(numbers_of(frame, key), lag),
            )
            for key in config.columns
            for lag in _checked(config.lags, MAX_LAG, "滞后期数")
        ]
        return {"frame": _appended(frame, made)}


class RollingFeatureConfig(OperatorConfig):
    """滚动统计的参数。"""

    columns: list[str] = column_field(
        title="哪几列",
        description="留空表示一列都不做",
        default_factory=list[str],
    )
    window: int = Field(
        default=3,
        ge=2,
        le=MAX_WINDOW,
        title="窗口宽度",
        description="连同当前行往前数这么多行",
    )
    stats: list[RollingStat] = Field(
        default_factory=lambda: ["mean"],
        min_length=1,
        title="算哪几个",
        description=(
            "mean=均值；sum=求和；min=最小；max=最大；std=标准差（总体口径）"
        ),
    )


@register_operator
class RollingFeature(OperatorBase):
    """在每一行上按前若干行算一个统计量。

    ⚠ 窗口不满的那几行给**空值**，不拿手上这几行凑合：凑合出来的均值与满窗口的
    均值不是同一个口径，而模型分不出来。
    """

    CODE = "rolling_feature"
    NAME = "滚动统计"
    DESCRIPTION = "在每一行上按前若干行算均值 / 求和 / 极值 / 标准差"
    CATEGORY = "feature"
    ICON = "activity"
    CONFIG_MODEL = RollingFeatureConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    SERVING_NEEDS_WINDOW = True

    @property
    def _config(self) -> RollingFeatureConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(
            self.config, RollingFeatureConfig
        ):  # pragma: no cover —— 参数由注册表按算子造，型别不会错
            raise OperatorError("滚动统计拿到了不匹配的参数")
        return self.config

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """原有的列全留着，后面接上造出来的那几列。

        Args: config, inputs。
        """
        given = inputs.get("frame")
        if given is None or not isinstance(config, RollingFeatureConfig):
            return {"frame": None}
        return {"frame": (*given, *_rolling_keys(config))}

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """逐列逐档算滚动统计。

        Args: inputs。
        """
        config = self._config
        frame = frame_input(inputs, "frame")
        _refuse_clashes(frame, _rolling_keys(config))
        made = [
            (
                f"{key}{FEATURE_JOINER}{stat}{config.window}",
                _rolled(numbers_of(frame, key), config.window, stat),
            )
            for key in config.columns
            for stat in _deduped(list(config.stats))
        ]
        return {"frame": _appended(frame, made)}


def _lag_keys(config: LagFeatureConfig) -> tuple[str, ...]:
    """滞后特征会造出哪几列。

    Args: config。
    """
    return tuple(
        f"{key}{FEATURE_JOINER}lag{lag}"
        for key in config.columns
        for lag in _checked(config.lags, MAX_LAG, "滞后期数")
    )


def _rolling_keys(config: RollingFeatureConfig) -> tuple[str, ...]:
    """滚动统计会造出哪几列。

    Args: config。
    """
    return tuple(
        f"{key}{FEATURE_JOINER}{stat}{config.window}"
        for key in config.columns
        for stat in _deduped(list(config.stats))
    )


def _checked(values: list[int], limit: int, label: str) -> list[int]:
    """去重、排序，并挡住越界的档位。

    Args: values, limit, label。
    """
    for value in values:
        if value < 1 or value > limit:
            raise OperatorError(
                f"{label}要在 1 到 {limit} 之间，给的是 {value}"
            )
    return sorted(set(values))


def _deduped(values: list[str]) -> list[str]:
    """按原序去重。

    Args: values。
    """
    seen: list[str] = []
    for value in values:
        if value not in seen:
            seen.append(value)
    return seen


def _refuse_clashes(frame: Frame, made: tuple[str, ...]) -> None:
    """要造的列名已经被占了就当场说清楚。

    Args: frame, made。
    """
    taken = set(frame.keys) & set(made)
    if taken:
        raise OperatorError(f"要造的列名已经有了：{'、'.join(sorted(taken))}")


def _shifted(values: list[float | None], lag: int) -> list[CellValue]:
    """往后挪 `lag` 行；挪出来的头几格是**空值**。

    ⚠ 填 0 会把「还没有历史」说成「历史上是 0」，而模型学到的是后者。
    Args: values, lag。
    """
    kept: list[CellValue] = list(values[: len(values) - lag])
    blanks: list[CellValue] = [None] * lag
    return blanks + kept


def _rolled(
    values: list[float | None], window: int, stat: str
) -> list[CellValue]:
    """一列的滚动统计。窗口不满或窗口内全空的那几行给空值。

    Args: values, window, stat。
    """
    found: list[CellValue] = []
    for position in range(len(values)):
        if position + 1 < window:
            found.append(None)
            continue
        chunk = [
            value
            for value in values[position + 1 - window : position + 1]
            if value is not None
        ]
        found.append(None if not chunk else _folded(chunk, stat))
    return found


def _folded(chunk: list[float], stat: str) -> float:
    """一窗数值按口径折成一个数。

    Args: chunk, stat。
    """
    if stat == "sum":
        return sum(chunk)
    if stat == "min":
        return min(chunk)
    if stat == "max":
        return max(chunk)
    mean = sum(chunk) / len(chunk)
    if stat == "mean":
        return mean
    return math.sqrt(sum((value - mean) ** 2 for value in chunk) / len(chunk))


def _appended(frame: Frame, made: list[tuple[str, list[CellValue]]]) -> Frame:
    """把造出来的几列接到帧的后面。

    Args: frame, made。
    """
    columns = (
        *frame.columns,
        *(
            FrameColumn(key=key, name=key, dtype=DTYPE_NUMBER)
            for key, _ in made
        ),
    )
    rows = tuple(
        (*row, *(values[position] for _, values in made))
        for position, row in enumerate(frame.rows)
    )
    return replace(frame, columns=columns, rows=rows)
