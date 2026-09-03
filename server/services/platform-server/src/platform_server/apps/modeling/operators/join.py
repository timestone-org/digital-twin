"""多台账按时间对齐。

⚠ 两边的列名会撞——同一个「温度」在两张台账上是两回事。右侧一律加前缀，前缀
定死不给配空串：配空了就成了静默覆盖，而下游拿到的是哪一张表的数看不出来。
⚠ 对齐按**时刻就近**，不是按行号：两张台账的采集周期常常不同，按行号并起来的
每一行都是错的，而每个数看着都正常。
"""

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
)
from platform_server.apps.modeling.operators.frame import (
    CellValue,
    Frame,
    frame_input,
)
from platform_server.apps.modeling.operators.registry import register_operator

# 对齐容差的上限：一天。⚠ 无界的话「就近」会退化成「随便找一行」
MAX_TOLERANCE_MS = 86_400_000

type JoinHow = Literal["inner", "left"]


class LedgerJoinConfig(OperatorConfig):
    """多台账对齐的参数。"""

    how: JoinHow = Field(
        default="inner",
        title="怎么并",
        description=(
            "inner=两边都有才留；left=以左边为准，右边没有的那几列留空"
        ),
    )
    tolerance_ms: int = Field(
        default=60_000,
        ge=0,
        le=MAX_TOLERANCE_MS,
        title="对齐容差（毫秒）",
        description="两边时刻相差不超过它才算同一时刻；0 表示必须完全相等",
    )
    right_prefix: str = Field(
        default="右_",
        min_length=1,
        max_length=16,
        title="右侧列名前缀",
        description="右边每一列都加上它，避免与左边同名",
    )


@register_operator
class LedgerJoin(OperatorBase):
    """把两份数据按时刻就近并成一份。"""

    CODE = "ledger_join"
    NAME = "多台账对齐"
    DESCRIPTION = "把两份数据按时刻就近并成一份，右侧列名加前缀"
    CATEGORY = "source"
    ICON = "link"
    CONFIG_MODEL = LedgerJoinConfig
    INPUTS = (
        PortSpec(name="left", contract=CONTRACT_FRAME, label="左"),
        PortSpec(name="right", contract=CONTRACT_FRAME, label="右"),
    )
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    CHANGES_ROW_COUNT = True
    # 推理时数据由调用方逐行给，对齐这一步整个跳过
    ENABLED_IN_SERVING = False

    @property
    def _config(self) -> LedgerJoinConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, LedgerJoinConfig):  # pragma: no cover
            raise OperatorError("多台账对齐拿到了不匹配的参数")
        return self.config

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """左边原样，右边每一列加前缀。

        Args: config, inputs。
        """
        left = inputs.get("left")
        right = inputs.get("right")
        if left is None or right is None:
            return {"frame": None}
        if not isinstance(config, LedgerJoinConfig):
            return {"frame": None}
        prefix = config.right_prefix
        return {"frame": (*left, *(f"{prefix}{key}" for key in right))}

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """按时刻就近并。两边都必须带时刻。

        Args: inputs。
        """
        config = self._config
        left = frame_input(inputs, "left")
        right = frame_input(inputs, "right")
        if left.index is None or right.index is None:
            raise OperatorError("两边都要带时刻才对得齐，请检查上游的取数")
        _refuse_prefix_clashes(left, right, config.right_prefix)
        matched = [
            _nearest(moment, right.index, config.tolerance_ms)
            for moment in left.index
        ]
        return {"frame": _joined(left, right, matched, config)}


def _refuse_prefix_clashes(left: Frame, right: Frame, prefix: str) -> None:
    """加完前缀之后仍与左边撞名就当场说清楚。

    Args: left, right, prefix。
    """
    taken = set(left.keys) & {f"{prefix}{key}" for key in right.keys}
    if taken:
        raise OperatorError(
            f"加上前缀之后仍与左边撞名：{'、'.join(sorted(taken))}，请换个前缀"
        )


def _nearest(moment: int, index: tuple[int, ...], tolerance: int) -> int | None:
    """右边离这个时刻最近的那一行；超出容差给 `None`。

    ⚠ 同样近时取**靠前**的那一行：不定的话同一份数据两次跑出来的行不同。
    Args: moment, index, tolerance。
    """
    best: int | None = None
    best_gap = tolerance + 1
    for position, other in enumerate(index):
        gap = abs(other - moment)
        if gap < best_gap:
            best, best_gap = position, gap
    return best


def _joined(
    left: Frame,
    right: Frame,
    matched: list[int | None],
    config: LedgerJoinConfig,
) -> Frame:
    """按匹配结果拼出并起来的帧。

    Args: left, right, matched, config。
    """
    kept = [
        position
        for position, found in enumerate(matched)
        if found is not None or config.how == "left"
    ]
    if not kept:
        raise OperatorError(
            "按这个容差一行都对不上，请把容差放宽或检查两边的时间范围"
        )
    blanks: tuple[CellValue, ...] = tuple(None for _ in right.columns)
    rows = tuple(
        (
            *left.rows[position],
            *(
                blanks
                if matched[position] is None
                else right.rows[matched[position] or 0]
            ),
        )
        for position in kept
    )
    columns = (
        *left.columns,
        *(
            replace(column, key=f"{config.right_prefix}{column.key}")
            for column in right.columns
        ),
    )
    return replace(
        left,
        columns=columns,
        rows=rows,
        index=(
            tuple(left.index[position] for position in kept)
            if left.index is not None
            else None
        ),
    )
