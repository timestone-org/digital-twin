"""带拟合的预处理算子：填缺失、离群裁剪。

这两个都在训练行上学一份参数、推理时回灌。不学参数的清洗算子在 `cleaning.py`
——那条线是本模块唯一的分法。
"""

import math
from typing import Any, Literal, cast

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
    column_field,
)
from platform_server.apps.modeling.operators.fitting import (
    fit_columns,
    training_frame,
)
from platform_server.apps.modeling.operators.frame import (
    CellValue,
    Frame,
    frame_input,
    numbers_of,
    with_column_values,
)
from platform_server.apps.modeling.operators.registry import register_operator

# 少于这么多个取值就定不出上下界——两个点的「标准差」没有意义
_MIN_BOUND_ROWS = 3

type FillStrategy = Literal["mean", "median", "constant"]
# 整列全空时的处置。skip 那一档不给这列记填充值，推理时也就跟着不填
type AllNullAction = Literal["error", "skip"]


class FillMissingConfig(OperatorConfig):
    """填缺失的参数。"""

    strategy: FillStrategy = Field(
        default="mean",
        title="填法",
        description="mean=均值；median=中位数；constant=固定值",
    )
    columns: list[str] = column_field(
        title="处理哪些列",
        description="留空表示除目标列外的全部数值列",
        default_factory=list[str],
    )
    value: float = Field(
        default=0.0,
        title="固定值",
        description="填法选 constant 时用它",
    )
    on_all_null: AllNullAction = Field(
        default="error",
        title="整列全空时",
        description=(
            "error=报错（固定值填法照填不误）；skip=这一列原样放过不填"
        ),
    )


@register_operator
class FillMissing(OperatorBase):
    """把数值列里的空值填上，填的值在训练时学、推理时回灌。"""

    CODE = "fill_missing"
    NAME = "填缺失"
    DESCRIPTION = "用均值 / 中位数 / 固定值补上数值列里的空值"
    CATEGORY = "preprocess"
    ICON = "droplets"
    CONFIG_MODEL = FillMissingConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    REQUIRES_FIT = True
    FILLS_MISSING = True

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._fills: dict[str, float] = {}

    @property
    def _config(self) -> FillMissingConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, FillMissingConfig):  # pragma: no cover
            raise OperatorError("填缺失拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """训练时按训练行算填充值，推理时用回灌的那份。

        Args: inputs。
        """
        frame = frame_input(inputs, "frame")
        keys = (
            tuple(self._fills)
            if self._fills
            else fit_columns(frame, self._config.columns, self.split_plan)
        )
        if not self._fills:
            self._fits(training_frame(frame, self.split_plan), keys)
        for key in self._fills:
            frame = with_column_values(frame, key, self._filled(frame, key))
        return {"frame": frame}

    def dump_fitted(self) -> dict[str, Any] | None:
        """按列 key 建键的填充值。"""
        return dict(self._fills)

    def load_fitted(self, params: dict[str, Any]) -> None:
        """回灌填充值。

        Args: params。
        """
        self.validate_fitted(params)
        self._fills = {key: float(value) for key, value in params.items()}

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """填充值必须是「列 key → 有限数」。

        Args: params。
        """
        for key, value in params.items():
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise OperatorError(f"列「{key}」的填充值不是数")

    def _fits(self, train: Frame, keys: tuple[str, ...]) -> None:
        config = self._config
        for key in keys:
            present = [
                value for value in numbers_of(train, key) if value is not None
            ]
            if not present and config.on_all_null == "skip":
                continue
            self._fills[key] = _fill_value(
                config.strategy, present, config.value, key
            )

    def _filled(self, frame: Frame, key: str) -> list[CellValue]:
        fill = self._fills[key]
        return [
            fill if value is None else value for value in numbers_of(frame, key)
        ]


def _fill_value(
    strategy: FillStrategy, present: list[float], constant: float, key: str
) -> float:
    """一列的填充值。整列皆空时只有固定值填法还能用。

    Args: strategy, present, constant, key。
    """
    if strategy == "constant":
        return constant
    if not present:
        raise OperatorError(
            f"列「{key}」整列都是空值，均值 / 中位数都算不出来，"
            "请改用固定值或把这一列去掉"
        )
    if strategy == "mean":
        return sum(present) / len(present)
    ordered = sorted(present)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


type OutlierMethod = Literal["zscore", "iqr"]
# 训练行上算不出上下界时的处置。skip 那一档不给这列记界限，推理时也就不裁
type NoBoundAction = Literal["error", "skip"]

# 上下界那两个键，落进拟合参数里
_LOW = "low"
_HIGH = "high"


class ClipOutlierConfig(OperatorConfig):
    """离群裁剪的参数。"""

    method: OutlierMethod = Field(
        default="zscore",
        title="怎么定界",
        description=(
            "zscore=按均值加减若干倍标准差；iqr=按四分位距向外扩若干倍"
        ),
    )
    threshold: float = Field(
        default=3.0,
        gt=0.0,
        title="倍数",
        description="zscore 是几倍标准差，iqr 是几倍四分位距",
    )
    columns: list[str] = column_field(
        title="处理哪些列",
        description="留空表示除目标列外的全部数值列",
        default_factory=list[str],
    )
    on_no_bound: NoBoundAction = Field(
        default="error",
        title="定不出界时",
        description="error=报错；skip=这一列原样放过不裁",
    )


@register_operator
class ClipOutlier(OperatorBase):
    """把离群值按训练期定下的上下界夹回来。

    ⚠ 只做**裁剪**，不做「丢掉离群行」也不做「打标记」：那两档一个会改行数、
    一个会加列，而 `ENABLED_IN_SERVING` / `CHANGES_ROW_COUNT` 是**类变量、看不见
    参数**。同一个算子按参数在「推理时跑」与「推理时不跑」之间摇摆，只能二选一：
    要么线上不裁（训练裁了线上不裁，就是一次静默的训练 / 线上偏移），要么整个
    不可服务。想丢离群行的用条件过滤，打标记那一档等到需要时另立一个算子。
    """

    CODE = "clip_outlier"
    NAME = "离群裁剪"
    DESCRIPTION = "按训练期定下的上下界把离群值夹回区间内"
    CATEGORY = "preprocess"
    ICON = "gauge"
    CONFIG_MODEL = ClipOutlierConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    REQUIRES_FIT = True

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._bounds: dict[str, dict[str, float]] = {}

    @property
    def _config(self) -> ClipOutlierConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, ClipOutlierConfig):  # pragma: no cover
            raise OperatorError("离群裁剪拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """训练时按训练行定界，推理时用回灌的那份。

        Args: inputs。
        """
        frame = frame_input(inputs, "frame")
        keys = (
            tuple(self._bounds)
            if self._bounds
            else fit_columns(frame, self._config.columns, self.split_plan)
        )
        if not self._bounds:
            self._fits(training_frame(frame, self.split_plan), keys)
        for key in self._bounds:
            frame = with_column_values(frame, key, self._clipped(frame, key))
        return {"frame": frame}

    def dump_fitted(self) -> dict[str, Any] | None:
        """按列 key 建键的上下界。"""
        return {key: dict(value) for key, value in self._bounds.items()}

    def load_fitted(self, params: dict[str, Any]) -> None:
        """回灌上下界。

        Args: params。
        """
        self.validate_fitted(params)
        self._bounds = {
            key: _bound_entry(key, value) for key, value in params.items()
        }

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """上下界必须是「列 key → {low, high}」且 low ≤ high。

        ⚠ 严格度与 `dump_fitted` 对齐：拟合期定不出界的列压根不记，这里不会比
        那边更严——校验器更严的话，自己训出来的模型会在发布那一刻被自己拒掉。
        Args: params。
        """
        for key, value in params.items():
            bound = _bound_entry(key, value)
            if bound[_LOW] > bound[_HIGH]:
                raise OperatorError(f"列「{key}」的下界比上界还大")

    def _fits(self, train: Frame, keys: tuple[str, ...]) -> None:
        config = self._config
        for key in keys:
            present = [
                value for value in numbers_of(train, key) if value is not None
            ]
            bound = _bound_of(config.method, present, config.threshold)
            if bound is not None:
                self._bounds[key] = bound
            elif config.on_no_bound != "skip":
                raise OperatorError(
                    f"列「{key}」在训练行上定不出上下界（取值太少或整列都空），"
                    "请把这一列从这一步里去掉"
                )

    def _clipped(self, frame: Frame, key: str) -> list[CellValue]:
        bound = self._bounds[key]
        return [
            (
                None
                if value is None
                else min(max(value, bound[_LOW]), bound[_HIGH])
            )
            for value in numbers_of(frame, key)
        ]


def _bound_entry(key: str, value: object) -> dict[str, float]:
    """把落库的一条上下界还原成结构。

    Args: key, value。
    """
    if not isinstance(value, dict):
        raise OperatorError(f"列「{key}」的上下界形状不对")
    entry = cast("dict[str, object]", value)
    try:
        return {
            _LOW: float(str(entry[_LOW])),
            _HIGH: float(str(entry[_HIGH])),
        }
    except (KeyError, ValueError) as error:
        raise OperatorError(f"列「{key}」的上下界不是两个数") from error


def _bound_of(
    method: OutlierMethod, present: list[float], threshold: float
) -> dict[str, float] | None:
    """一列的上下界；取值太少定不出来时给 `None`。

    Args: method, present, threshold。
    """
    if len(present) < _MIN_BOUND_ROWS:
        return None
    if method == "iqr":
        return _iqr_bound(present, threshold)
    return _zscore_bound(present, threshold)


def _zscore_bound(present: list[float], threshold: float) -> dict[str, float]:
    mean = sum(present) / len(present)
    variance = sum((value - mean) ** 2 for value in present) / len(present)
    spread = math.sqrt(variance) * threshold
    return {_LOW: mean - spread, _HIGH: mean + spread}


def _iqr_bound(present: list[float], threshold: float) -> dict[str, float]:
    ordered = sorted(present)
    first = _quantile(ordered, 0.25)
    third = _quantile(ordered, 0.75)
    spread = (third - first) * threshold
    return {_LOW: first - spread, _HIGH: third + spread}


def _quantile(ordered: list[float], ratio: float) -> float:
    """有序取值上的线性插值分位数。

    Args: ordered, ratio。
    """
    position = ratio * (len(ordered) - 1)
    low = math.floor(position)
    high = math.ceil(position)
    if low == high:
        return ordered[low]
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)
