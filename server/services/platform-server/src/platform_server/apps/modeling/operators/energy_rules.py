"""能源规则算子及可发布的结构化核算入口；口径见 platform ADR-0004。"""

from collections.abc import Iterator
from typing import Any

from pydantic import ValidationError

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    CONTRACT_MODEL,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.energy_rule_calculation import (
    evaluate_energy_rule,
)
from platform_server.apps.modeling.operators.energy_rule_config import (
    TASK_RULES,
    EnergyRulesConfig,
    required_columns,
)
from platform_server.apps.modeling.operators.energy_rule_details import (
    detail_columns,
    detail_row,
)
from platform_server.apps.modeling.operators.frame import (
    CellValue,
    Frame,
    FrameColumn,
    frame_input,
)
from platform_server.apps.modeling.operators.payloads import ModelPayload
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import (
    BlockAt,
    ReportBlock,
    RowCounts,
    Scale,
    breakdown_block,
    rows_block,
)

SUMMARY_KEY = "rule_value"
MAX_RULE_REPORT_SAMPLES = 3


@register_operator
class EnergyRules(OperatorBase):
    """无拟合、无目标列的能源确定性规则模型。"""

    config: OperatorConfig

    CODE = "energy_rules"
    NAME = "能源业务规则"
    DESCRIPTION = "按明确阈值、计量分类与流向拓扑计算，并返回可核对的业务明细"
    CATEGORY = "model"
    ICON = "activity"
    CONFIG_MODEL = EnergyRulesConfig
    INPUTS = (
        PortSpec(name="frame", contract=CONTRACT_FRAME, label="业务观测"),
    )
    OUTPUTS = (
        PortSpec(name="model", contract=CONTRACT_MODEL, label="规则模型"),
        PortSpec(name="scored", contract=CONTRACT_FRAME, label="计算摘要"),
        PortSpec(name="details", contract=CONTRACT_FRAME, label="核算明细"),
    )
    SERVING_CHANNEL = "json"

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._results: list[dict[str, object]] | None = None
        self._row_count = 0

    @property
    def rule_config(self) -> EnergyRulesConfig:
        if not isinstance(self.config, EnergyRulesConfig):
            raise OperatorError("能源规则拿到了不匹配的配置")
        return self.config

    def input_columns(self) -> tuple[str, ...]:
        return required_columns(self.rule_config)

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """计算摘要只包含主数值；Args: config, inputs。"""
        del inputs
        if not isinstance(config, EnergyRulesConfig):
            raise OperatorError("能源规则拿到了不匹配的配置")
        return {
            "scored": (SUMMARY_KEY,),
            "details": tuple(
                column.key for column in detail_columns(config.kind)
            ),
        }

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """固化规则配置并核算输入观测；Args: inputs。"""
        frame = frame_input(inputs, "frame")
        if not frame.rows:
            raise OperatorError("能源规则至少需要一条完整观测")
        self._results = []
        self._row_count = frame.row_count
        values: list[float] = []
        columns = detail_columns(self.rule_config.kind)
        details: list[tuple[CellValue, ...]] = []
        for row in self._input_rows(frame):
            result = evaluate_energy_rule(self.rule_config, row)
            values.append(self._summary(result))
            details.append(detail_row(result, columns))
            if len(self._results) < MAX_RULE_REPORT_SAMPLES:
                self._results.append(result)
        return {
            "model": ModelPayload(
                algo=self.CODE,
                task=TASK_RULES,
                feature_keys=self.input_columns(),
                target_key=None,
                hyper_params=self.rule_config.model_dump(mode="json"),
                fitted=self.dump_fitted(),
                serving_channel=self.SERVING_CHANNEL,
            ),
            "scored": Frame(
                columns=(
                    FrameColumn(
                        key=SUMMARY_KEY, name="规则计算主数值", dtype="number"
                    ),
                ),
                rows=tuple((value,) for value in values),
                index=frame.index,
                provenance=frame.provenance,
            ),
            "details": Frame(
                columns=columns,
                rows=tuple(details),
                index=frame.index,
                provenance=frame.provenance,
            ),
        }

    def calculate_rows(self, frame: Frame) -> list[dict[str, object]]:
        """线上线下共用的结构化规则计算；Args: frame。"""
        return [
            evaluate_energy_rule(self.rule_config, values)
            for values in self._input_rows(frame)
        ]

    def _input_rows(self, frame: Frame) -> Iterator[dict[str, object]]:
        """逐行校验输入形状；Args: frame。"""
        missing = set(self.input_columns()) - set(frame.keys)
        if missing:
            raise OperatorError(f"规则缺少业务列：{'、'.join(sorted(missing))}")
        if len(frame.keys) != len(set(frame.keys)):
            raise OperatorError("规则输入不能包含重复列")
        for row in frame.rows:
            if len(row) != len(frame.keys):
                raise OperatorError("规则输入的列数与观测值数量不一致")
            values: dict[str, object] = dict(zip(frame.keys, row, strict=True))
            yield values

    def predict_rows(self, frame: Frame) -> list[float]:
        """主数值仅用于摘要与发布校验；Args: frame。"""
        return [self._summary(result) for result in self.calculate_rows(frame)]

    @staticmethod
    def _summary(result: dict[str, object]) -> float:
        value = result.get("summary_value")
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise OperatorError("规则没有生成有效的计算摘要")
        return float(value)

    def dump_fitted(self) -> dict[str, Any]:
        return {"config": self.rule_config.model_dump(mode="json")}

    def load_fitted(self, params: dict[str, Any]) -> None:
        """加载冻结的规则配置；Args: params。"""
        self.validate_fitted(params)
        self.config = EnergyRulesConfig.model_validate(params["config"])

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """规则参数必须完整且可校验；Args: params。"""
        raw = params.get("config")
        if not isinstance(raw, dict):
            raise OperatorError("规则模型缺少有效参数")
        try:
            EnergyRulesConfig.model_validate(raw)
        except ValidationError as error:
            raise OperatorError("规则模型参数不合法") from error

    def report(self) -> tuple[ReportBlock, ...]:
        if self._results is None:
            return ()
        return (
            rows_block(
                BlockAt(zone="step", title="按冻结业务规则逐行计算"),
                RowCounts(before=self._row_count, after=self._row_count),
            ),
            breakdown_block(
                BlockAt(
                    zone="charts",
                    title="计算摘要（完整明细见部署计算接口）",
                    is_primary=True,
                ),
                Scale(label="规则主数值"),
                [
                    {"name": f"观测{index + 1}", "value": self._summary(result)}
                    for index, result in enumerate(self._results)
                ],
            ),
        )


__all__ = [
    "TASK_RULES",
    "EnergyRules",
    "EnergyRulesConfig",
    "evaluate_energy_rule",
    "required_columns",
]
