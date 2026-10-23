"""规则结果的稳定明细列与有界表格文本。"""

import json

from platform_server.apps.modeling.operators.energy_rule_config import (
    EnergyRuleKind,
)
from platform_server.apps.modeling.operators.frame import CellValue, FrameColumn

MAX_RULE_DETAIL_TEXT = 1024
TRUNCATION_NOTE = "…（此格已截断，完整明细请使用部署计算接口）"


def detail_columns(kind: EnergyRuleKind) -> tuple[FrameColumn, ...]:
    """规则结果列与实际输出保持相同顺序；Args: kind。"""
    fields: dict[EnergyRuleKind, tuple[tuple[str, str], ...]] = {
        **_flow_fields(),
        "hvac_compliance": (
            ("is_compliant", "是否达标"),
            ("violations", "未达标规则"),
            ("observations", "观测指标"),
        ),
        "efficiency_fluctuation": (
            ("change_pct", "能效变化率(%)"),
            ("threshold_pct", "波动阈值(%)"),
            ("is_fluctuating", "是否明显波动"),
            ("comparison_scope", "比较口径"),
        ),
        "unit_consumption": (
            ("energy", "期间能耗"),
            ("output", "期间产量"),
            ("unit_consumption", "单位能耗"),
        ),
        "efficiency_benchmark": (
            ("ratio", "对标比值"),
            ("deviation_pct", "偏差率(%)"),
            ("grade", "对标级别"),
            ("comparison_direction", "对标方向"),
        ),
        "equipment_efficiency": (
            ("cop", "设备COP"),
            ("threshold", "COP达标阈值"),
            ("grade", "能效级别"),
            ("measurement_requirement", "计量要求"),
        ),
        "supply_diagnosis": (
            ("is_abnormal", "是否供应异常"),
            ("diagnosis_codes", "诊断代码"),
            ("matched_rules", "命中测量规则"),
            ("diagnostic_scope", "诊断口径"),
        ),
    }
    return tuple(
        FrameColumn(
            key=key,
            name=name,
            dtype="bool" if key.startswith("is_") else "string",
        )
        for key, name in fields[kind]
    )


def _flow_fields() -> dict[EnergyRuleKind, tuple[tuple[str, str], ...]]:
    return {
        "energy_aggregation": (
            ("total_standard_coal_kg", "折标煤总量(kgce)"),
            ("totals_by_unit", "分单位总量"),
            ("breakdown", "分类归集明细"),
            ("meters", "计量与折标系数"),
            ("factor_source", "系数来源"),
        ),
        "energy_trace": (
            ("unit", "能源单位"),
            ("total_supply", "总供入"),
            ("total_consumption", "总消耗"),
            ("total_edge_loss", "边传输损耗"),
            ("total_node_imbalance", "节点净差额"),
            ("conservation_residual", "全图守恒余量"),
            ("is_balanced", "节点是否平衡"),
            ("nodes", "节点守恒明细"),
            ("paths", "能源路径"),
            ("edges", "边计量明细"),
        ),
    }


def detail_row(
    result: dict[str, object], columns: tuple[FrameColumn, ...]
) -> tuple[CellValue, ...]:
    """结构明细保留原值，仅截断表格中的长文本；Args: result, columns。"""
    return tuple(_detail_cell(result.get(column.key)) for column in columns)


def _detail_cell(value: object) -> CellValue:
    if value is None or isinstance(value, bool):
        return value
    text = (
        value
        if isinstance(value, str)
        else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    )
    if len(text) <= MAX_RULE_DETAIL_TEXT:
        return text
    return text[: MAX_RULE_DETAIL_TEXT - len(TRUNCATION_NOTE)] + TRUNCATION_NOTE
