"""特征工程算子：把整理好的列变换成模型吃得下的尺度。"""

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

type ScaleMethod = Literal["zscore", "minmax"]
# 训练行上只有一个取值时的处置。skip 那一档不给这列记尺度，推理时也就跟着不缩放
type ConstantColumnAction = Literal["error", "skip"]

# 尺度为 0 的列（整列同一个值）除不得。⚠ 这一条在**拟合期**就要拒绝，
# 不能留到推理期才抛：那样模型训出来了、上线才炸（docs/MODELING_DESIGN.md §7.3）
_ZERO_SCALE = 0.0


class StandardizeConfig(OperatorConfig):
    """标准化的参数。"""

    method: ScaleMethod = Field(
        default="zscore",
        title="标准化方式",
        description="zscore=减均值除标准差；minmax=线性压到 0~1",
    )
    columns: list[str] = column_field(
        title="处理哪些列",
        description="留空表示除目标列外的全部数值列",
        default_factory=list[str],
    )
    on_constant_column: ConstantColumnAction = Field(
        default="error",
        title="常量列时",
        description="error=报错；skip=这一列原样放过不缩放",
    )


@register_operator
class Standardize(OperatorBase):
    """把数值列压到同一尺度，尺度参数训练时学、推理时回灌。"""

    CODE = "standardize"
    NAME = "标准化"
    DESCRIPTION = "把数值列按 z-score 或 min-max 压到同一尺度"
    CATEGORY = "feature"
    ICON = "ruler"
    CONFIG_MODEL = StandardizeConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    REQUIRES_FIT = True

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._scales: dict[str, dict[str, float]] = {}

    @property
    def _config(self) -> StandardizeConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, StandardizeConfig):  # pragma: no cover
            raise OperatorError("标准化拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """训练时按训练行算尺度，推理时用回灌的那份。

        Args: inputs。
        """
        frame = frame_input(inputs, "frame")
        keys = (
            tuple(self._scales)
            if self._scales
            else fit_columns(frame, self._config.columns, self.split_plan)
        )
        if not self._scales:
            self._fits(training_frame(frame, self.split_plan), keys)
        for key in self._scales:
            frame = with_column_values(frame, key, self._scaled(frame, key))
        return {"frame": frame}

    def dump_fitted(self) -> dict[str, Any] | None:
        """按列 key 建键的尺度参数。"""
        return {key: dict(value) for key, value in self._scales.items()}

    def load_fitted(self, params: dict[str, Any]) -> None:
        """回灌尺度参数。

        Args: params。
        """
        self.validate_fitted(params)
        self._scales = {
            key: _scale_entry(key, value) for key, value in params.items()
        }

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """尺度参数必须是「列 key → {center, scale}」且 scale 不为 0。

        ⚠ 严格度与 `dump_fitted` 对齐：拟合期已经拒过尺度为 0 的列，这里不会
        比那边更严。
        Args: params。
        """
        for key, value in params.items():
            scale = _scale_entry(key, value)
            if scale["scale"] == _ZERO_SCALE:
                raise OperatorError(f"列「{key}」的尺度为 0")

    def _fits(self, train: Frame, keys: tuple[str, ...]) -> None:
        config = self._config
        for key in keys:
            present = [
                value for value in numbers_of(train, key) if value is not None
            ]
            if not present:
                raise OperatorError(f"列「{key}」在训练行上整列都是空值")
            scale = _scale_of(config.method, present)
            if scale["scale"] != _ZERO_SCALE:
                self._scales[key] = scale
            elif config.on_constant_column != "skip":
                raise OperatorError(
                    f"列「{key}」在训练行上只有一个取值，标准化会除以 0，"
                    "请把这一列从这一步里去掉"
                )

    def _scaled(self, frame: Frame, key: str) -> list[CellValue]:
        scale = self._scales[key]
        center, span = scale["center"], scale["scale"]
        return [
            None if value is None else (value - center) / span
            for value in numbers_of(frame, key)
        ]


def _scale_entry(key: str, raw: object) -> dict[str, float]:
    """把一份落库的尺度参数还原成两个数；形状不对即抛。

    Args: key, raw。
    """
    if not isinstance(raw, dict):
        raise OperatorError(f"列「{key}」的尺度参数形状不对")
    entry = cast("dict[str, object]", raw)
    if set(entry) != {"center", "scale"}:
        raise OperatorError(f"列「{key}」的尺度参数缺 center / scale")
    return {name: float(str(entry[name])) for name in ("center", "scale")}


def _scale_of(method: ScaleMethod, present: list[float]) -> dict[str, float]:
    """一列的中心与尺度。整列同一个值时 scale 为 0，由调用方决定怎么处置。

    Args: method, present。
    """
    if method == "minmax":
        low, high = min(present), max(present)
        center, span = low, high - low
    else:
        center = sum(present) / len(present)
        variance = sum((value - center) ** 2 for value in present) / len(
            present
        )
        span = variance**0.5
    return {"center": center, "scale": span}
