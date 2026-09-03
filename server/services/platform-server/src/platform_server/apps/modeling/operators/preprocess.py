"""数据预处理算子：把取来的数据整理成能进模型的样子。"""

from typing import Any, Literal

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
