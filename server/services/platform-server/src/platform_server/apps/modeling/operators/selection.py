"""训练准备阶段的显式选列，保持元数据、时间索引和出处。"""

from dataclasses import replace
from typing import Annotated, Self

from pydantic import Field, model_validator

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    PortSpec,
)
from platform_server.apps.modeling.operators.frame import Frame, frame_input
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import (
    BlockAt,
    ColumnChange,
    ReportBlock,
    columns_block,
)


class SelectColumnsConfig(OperatorConfig):
    """必须显式指定且不能重复的列清单。"""

    columns: list[Annotated[str, Field(min_length=1)]] = Field(
        min_length=1,
        max_length=256,
        title="保留哪些列",
        description="只保留这些列；训练时须包含目标列。排除编号和预测时未知的字段",
        json_schema_extra={"x-dt-widget": "column"},
    )

    @model_validator(mode="after")
    def unique_columns(self) -> Self:
        if len(self.columns) != len(set(self.columns)):
            raise ValueError("保留的列不能重复")
        return self


@register_operator
class SelectColumns(OperatorBase):
    """在训练准备阶段收窄列集合。"""

    CODE = "select_columns"
    NAME = "选择数据列"
    DESCRIPTION = "明确保留特征和目标列，排除无关编号及预测时未知的列"
    CATEGORY = "preprocess"
    ICON = "list-checks"
    CONFIG_MODEL = SelectColumnsConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    ENABLED_IN_SERVING = False

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._selection = SelectColumnsConfig.model_validate(
            config.model_dump()
        )
        self._change: ColumnChange | None = None

    def run(self, inputs: dict[str, object]) -> dict[str, Frame]:
        """按配置列序取子矩阵。Args: inputs。"""
        frame = frame_input(inputs, "frame")
        keys = self._selection.columns
        positions = [frame.position_of(key) for key in keys]
        self._change = ColumnChange(
            removed=tuple(key for key in frame.keys if key not in keys),
            kept=len(keys),
            reason="仅保留显式选择的列",
        )
        return {
            "frame": replace(
                frame,
                columns=tuple(
                    frame.columns[position] for position in positions
                ),
                rows=tuple(
                    tuple(row[position] for position in positions)
                    for row in frame.rows
                ),
            )
        }

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        del inputs
        selected = SelectColumnsConfig.model_validate(config.model_dump())
        return {"frame": tuple(selected.columns)}

    def report(self) -> tuple[ReportBlock, ...]:
        if self._change is None:
            return ()
        return (
            columns_block(
                BlockAt(zone="step", title="保留与剔除的列", port="frame"),
                self._change,
            ),
        )
