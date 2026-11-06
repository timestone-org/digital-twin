"""预测后处理算子：在模型算出预测值之后、交给调用方之前修整这个数。

三个算子都接在模型的打分口上，训练时改写打分帧的预测列，推理时改写模型算出的
那个数，两边共用 `adjust_rows`（docs/MODELING_DESIGN.md §5.8）。
"""

import math
from collections.abc import Callable, Sequence
from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP, Context, Decimal
from operator import eq, ge, gt, le, lt, ne
from typing import Any, Literal, Self

from pydantic import Field, model_validator

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.frame import (
    frame_input,
    numbers_of,
    with_column_values,
)
from platform_server.apps.modeling.operators.model import SCORED_PRED
from platform_server.apps.modeling.operators.modelstats import with_hints
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import (
    TIER_SCALAR,
    TIER_SMALL,
    BlockAt,
    CellChange,
    ReportBlock,
    bins_block,
    cells_block,
)
from platform_server.apps.modeling.operators.steps import (
    column_bins,
    spread_of,
)

PORT = "scored"
# 取整的精度上限，够覆盖 float 的全部有效位
MAX_DECIMALS = 6
# float 最长约 310 位整数，再加小数位也不会让 quantize 溢出
_DECIMAL_PRECISION = 340
UNTOUCHED_NOTE = "这批测试行一个数都没有被改：规则在这批数据上没有触发"

type CompareOp = Literal["lt", "lte", "gt", "gte", "eq", "ne"]
type RoundMode = Literal["nearest", "floor", "ceil"]

_COMPARE: dict[str, Callable[[float, float], bool]] = {
    "lt": lt,
    "lte": le,
    "gt": gt,
    "gte": ge,
    "eq": eq,
    "ne": ne,
}
_ROUNDING: dict[str, str] = {
    "nearest": ROUND_HALF_UP,
    "floor": ROUND_FLOOR,
    "ceil": ROUND_CEILING,
}


class PredictionPostprocess(OperatorBase):
    """后处理算子的共同骨架：子类只回答「一个数改成什么」。

    ⚠ 不在 `ENABLED_IN_SERVING` 之外另设开关：训练评估过、线上却不处理，就是
    一次静默的训练 / 线上偏移。
    """

    CATEGORY = "postprocess"
    ICON = "ruler"
    INPUTS = (
        PortSpec(
            name=PORT,
            contract=CONTRACT_FRAME,
            label="模型打分",
            description="回归模型或上一个后处理的打分输出",
        ),
    )
    OUTPUTS = (
        PortSpec(name=PORT, contract=CONTRACT_FRAME, label="处理后打分"),
    )

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._before: list[float | None] = []
        self._after: list[float | None] = []

    def adjust(self, value: float) -> float:
        """把一个有限的预测值改成该有的样子。

        Args: value。
        """
        raise NotImplementedError

    def adjust_rows(self, values: Sequence[float | None]) -> list[float | None]:
        """逐行改写预测值，空值与非有限值原样放过。

        ⚠ 训练与推理都走这一个方法。NaN 不改写：把「算不出来」改成边界值，
        调用方就分不清这是真预测还是兜底。
        Args: values。
        """
        return [
            (
                value
                if value is None or not math.isfinite(value)
                else self.adjust(value)
            )
            for value in values
        ]

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """改写打分帧的预测列，其余列与行序不动。

        Args: inputs。
        """
        frame = frame_input(inputs, PORT)
        self._before = numbers_of(frame, SCORED_PRED)
        self._after = self.adjust_rows(self._before)
        return {PORT: with_column_values(frame, SCORED_PRED, [*self._after])}

    def report(self) -> tuple[ReportBlock, ...]:
        """后处理的两块：改了多少个数、改前改后的分布。"""
        if not self._before:
            return ()
        return (self._changed_block(), *self._bins_blocks())

    def _changed_block(self) -> ReportBlock:
        changed = [
            before
            for before, after in zip(self._before, self._after, strict=True)
            if before is not None and math.isfinite(before) and before != after
        ]
        made = cells_block(
            BlockAt(
                zone="step",
                title="改了多少个预测值",
                port=PORT,
                tier=TIER_SCALAR,
            ),
            [
                CellChange(
                    key=SCORED_PRED,
                    changed=len(changed),
                    low=min(changed, default=None),
                    high=max(changed, default=None),
                    samples=tuple(changed),
                )
            ],
        )
        return made if changed else with_hints(made, (UNTOUCHED_NOTE,))

    def _bins_blocks(self) -> tuple[ReportBlock, ...]:
        """两列共用一条轴：各按各的跨度分桶的话看不出被改动了多少。"""
        numbers = [
            value
            for value in (*self._before, *self._after)
            if value is not None and math.isfinite(value)
        ]
        if not numbers:
            return ()
        low, high = min(numbers), max(numbers)
        return (
            bins_block(
                BlockAt(
                    zone="charts",
                    title="预测值改前改后的分布",
                    port=PORT,
                    tier=TIER_SMALL,
                    is_primary=True,
                ),
                (
                    column_bins(
                        "改前", spread_of(self._before, low=low, high=high)
                    ),
                    column_bins(
                        "改后", spread_of(self._after, low=low, high=high)
                    ),
                ),
            ),
        )


class ClampPredictionConfig(OperatorConfig):
    """限幅的参数。默认就是「小于 0 时取 0」。"""

    lower: float | None = Field(
        default=0.0,
        title="下限",
        description="预测值低于它时取它；留空表示不设下限",
    )
    upper: float | None = Field(
        default=None,
        title="上限",
        description="预测值高于它时取它；留空表示不设上限",
    )

    @model_validator(mode="after")
    def check_bounds(self) -> Self:
        if self.lower is None and self.upper is None:
            raise ValueError("下限与上限至少填一个")
        if (
            self.lower is not None
            and self.upper is not None
            and self.lower > self.upper
        ):
            raise ValueError("下限不能大于上限")
        return self


@register_operator
class ClampPrediction(PredictionPostprocess):
    """把预测值夹进给定区间。"""

    CODE = "clamp_prediction"
    NAME = "预测限幅"
    DESCRIPTION = "预测值超出上下限时取边界值，例如小于 0 时等于 0"
    CONFIG_MODEL = ClampPredictionConfig

    def adjust(self, value: float) -> float:
        """夹进区间。

        Args: value。
        """
        config = self.config
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(config, ClampPredictionConfig):  # pragma: no cover
            raise OperatorError("预测限幅拿到了不匹配的参数")
        if config.lower is not None and value < config.lower:
            return config.lower
        if config.upper is not None and value > config.upper:
            return config.upper
        return value


class ReplacePredictionConfig(OperatorConfig):
    """条件替换的参数：一个运算 + 两个数，都是闭合的。"""

    op: CompareOp = Field(
        default="lt",
        title="预测值",
        description=(
            "lt=小于；lte=小于等于；gt=大于；gte=大于等于；eq=等于；ne=不等于"
        ),
    )
    threshold: float = Field(default=0.0, title="比较值")
    value: float = Field(
        default=0.0, title="替换成", description="条件成立时预测值改成这个数"
    )


@register_operator
class ReplacePrediction(PredictionPostprocess):
    """条件成立时把预测值换成给定的数。"""

    CODE = "replace_prediction"
    NAME = "预测条件替换"
    DESCRIPTION = "预测值满足条件时换成给定的数，例如小于 5 时等于 0"
    CONFIG_MODEL = ReplacePredictionConfig

    def adjust(self, value: float) -> float:
        """命中条件就替换。

        Args: value。
        """
        config = self.config
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(config, ReplacePredictionConfig):  # pragma: no cover
            raise OperatorError("预测条件替换拿到了不匹配的参数")
        if _COMPARE[config.op](value, config.threshold):
            return config.value
        return value


class RoundPredictionConfig(OperatorConfig):
    """取整的参数。"""

    decimals: int = Field(
        default=0,
        ge=0,
        le=MAX_DECIMALS,
        title="保留几位小数",
        description="0 表示取整数",
    )
    mode: RoundMode = Field(
        default="nearest",
        title="取整方式",
        description="nearest=四舍五入；floor=向下取整；ceil=向上取整",
    )


@register_operator
class RoundPrediction(PredictionPostprocess):
    """按给定小数位取整。"""

    CODE = "round_prediction"
    NAME = "预测取整"
    DESCRIPTION = "把预测值保留到给定小数位，可选四舍五入、向下或向上"
    CONFIG_MODEL = RoundPredictionConfig

    def adjust(self, value: float) -> float:
        """走十进制取整。

        ⚠ 不用内置 `round`：它是银行家舍入且受二进制表示影响，
        2.5 会得到 2、1.005 保留两位会得到 1.0。
        Args: value。
        """
        config = self.config
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(config, RoundPredictionConfig):  # pragma: no cover
            raise OperatorError("预测取整拿到了不匹配的参数")
        return float(
            Decimal(str(value)).quantize(
                Decimal(1).scaleb(-config.decimals),
                rounding=_ROUNDING[config.mode],
                context=Context(prec=_DECIMAL_PRECISION),
            )
        )
