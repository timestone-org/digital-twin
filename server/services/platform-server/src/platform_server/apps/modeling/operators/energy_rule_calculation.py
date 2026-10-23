"""八种能源业务规则的确定性计算，不从样本拟合核算公式。"""

from collections.abc import Callable, Mapping
from decimal import Decimal, localcontext

from platform_server.apps.modeling.operators.energy_rule_config import (
    EnergyMeter,
    EnergyRuleKind,
    EnergyRuleParameters,
    EnergyRulesConfig,
    configured_meters,
    default_fields,
)
from platform_server.apps.modeling.operators.energy_rule_math import (
    DECIMAL_WORK_PRECISION,
    PERCENT,
    decimal_text,
    divide,
    nonnegative_of,
    number_of,
)
from platform_server.apps.modeling.operators.energy_trace import trace_energy

type RuleValues = Mapping[str, Decimal]
type RuleFunction = Callable[[EnergyRulesConfig, RuleValues], dict[str, object]]


def evaluate_energy_rule(
    config: EnergyRulesConfig, row: Mapping[str, object]
) -> dict[str, object]:
    """按冻结配置核算一次观测；Args: config, row。"""
    with localcontext() as context:
        context.prec = DECIMAL_WORK_PRECISION
        result = _calculate(config, row)
    return {
        "kind": config.kind,
        "calculation_method": "deterministic_rule",
        "decimal_places": config.parameters.decimal_places,
        **result,
    }


def _calculate(
    config: EnergyRulesConfig, row: Mapping[str, object]
) -> dict[str, object]:
    if config.kind == "energy_aggregation":
        return _aggregate(config, row)
    if config.kind == "energy_trace":
        return trace_energy(config, row)
    functions: dict[EnergyRuleKind, RuleFunction] = {
        "hvac_compliance": _compliance,
        "efficiency_fluctuation": _fluctuation,
        "unit_consumption": _unit_consumption,
        "efficiency_benchmark": _benchmark,
        "equipment_efficiency": _equipment,
        "supply_diagnosis": _diagnosis,
    }
    reader = number_of if config.kind == "hvac_compliance" else nonnegative_of
    values = {
        key: reader(row, config.fields.get(key, name))
        for key, name in default_fields(config.kind)
    }
    return functions[config.kind](config, values)


def _compliance(
    config: EnergyRulesConfig, values: RuleValues
) -> dict[str, object]:
    parameters = config.parameters
    limits = (
        ("temperature", parameters.temperature_min, parameters.temperature_max),
        ("humidity", parameters.humidity_min, parameters.humidity_max),
    )
    violations = [
        f"{key}_{side}"
        for key, lower, upper in limits
        for side in _violations(values[key], lower, upper)
    ]
    return {
        "is_compliant": not violations,
        "violations": violations,
        "observations": _observations(values, parameters.decimal_places),
        "summary_value": float(not violations),
    }


def _violations(value: Decimal, lower: float, upper: float) -> list[str]:
    if value < Decimal(str(lower)):
        return ["low"]
    if value > Decimal(str(upper)):
        return ["high"]
    return []


def _observations(values: RuleValues, places: int) -> dict[str, str]:
    return {key: decimal_text(value, places) for key, value in values.items()}


def _fluctuation(
    config: EnergyRulesConfig, values: RuleValues
) -> dict[str, object]:
    change = (
        divide(
            values["current_efficiency"] - values["reference_efficiency"],
            values["reference_efficiency"],
        )
        * PERCENT
    )
    threshold = Decimal(str(config.parameters.fluctuation_threshold_pct))
    return {
        "change_pct": decimal_text(change, config.parameters.decimal_places),
        "threshold_pct": str(threshold),
        "is_fluctuating": abs(change) > threshold,
        "comparison_scope": "provided_current_and_reference",
        "summary_value": float(change),
    }


def _unit_consumption(
    config: EnergyRulesConfig, values: RuleValues
) -> dict[str, object]:
    value = divide(values["energy"], values["output"])
    return {
        "energy": decimal_text(
            values["energy"], config.parameters.decimal_places
        ),
        "output": decimal_text(
            values["output"], config.parameters.decimal_places
        ),
        "unit_consumption": decimal_text(
            value, config.parameters.decimal_places
        ),
        "summary_value": float(value),
    }


def _benchmark(
    config: EnergyRulesConfig, values: RuleValues
) -> dict[str, object]:
    ratio = divide(values["actual_intensity"], values["benchmark_intensity"])
    deviation = (ratio - 1) * PERCENT
    grade = "inefficient"
    if ratio <= Decimal(str(config.parameters.benchmark_good_ratio)):
        grade = "good"
    elif ratio <= Decimal(str(config.parameters.benchmark_warning_ratio)):
        grade = "attention"
    return {
        "ratio": decimal_text(ratio, config.parameters.decimal_places),
        "deviation_pct": decimal_text(
            deviation, config.parameters.decimal_places
        ),
        "grade": grade,
        "comparison_direction": "lower_intensity_is_better",
        "summary_value": float(deviation),
    }


def _equipment(
    config: EnergyRulesConfig, values: RuleValues
) -> dict[str, object]:
    cop = divide(values["useful_output"], values["input_power"])
    threshold = Decimal(str(config.parameters.cop_min))
    return {
        "cop": decimal_text(cop, config.parameters.decimal_places),
        "threshold": str(threshold),
        "grade": "efficient" if cop >= threshold else "inefficient",
        "measurement_requirement": "same_interval_and_power_unit",
        "summary_value": float(cop),
    }


def _diagnosis(
    config: EnergyRulesConfig, values: RuleValues
) -> dict[str, object]:
    hits: list[dict[str, object]] = []
    for key, lower, upper, low_code, high_code in _supply_limits(
        config.parameters
    ):
        sides = _violations(values[key], lower, upper)
        if sides:
            hits.append(
                {
                    "code": low_code if sides[0] == "low" else high_code,
                    "indicator": key,
                    "observed": str(values[key]),
                    "lower": str(lower),
                    "upper": str(upper),
                }
            )
    return {
        "is_abnormal": bool(hits),
        "diagnosis_codes": [hit["code"] for hit in hits],
        "matched_rules": hits,
        "diagnostic_scope": "measured_limit_violation",
        "summary_value": float(len(hits)),
    }


def _supply_limits(
    parameters: EnergyRuleParameters,
) -> tuple[tuple[str, float, float, str, str], ...]:
    return (
        (
            "voltage",
            parameters.voltage_min,
            parameters.voltage_max,
            "undervoltage",
            "overvoltage",
        ),
        (
            "frequency",
            parameters.frequency_min,
            parameters.frequency_max,
            "underfrequency",
            "overfrequency",
        ),
        (
            "pressure",
            parameters.pressure_min,
            parameters.pressure_max,
            "low_pressure",
            "high_pressure",
        ),
        (
            "flow",
            parameters.flow_min,
            parameters.flow_max,
            "low_flow",
            "high_flow",
        ),
    )


def _aggregate(
    config: EnergyRulesConfig, row: Mapping[str, object]
) -> dict[str, object]:
    grouped: dict[tuple[str, str], tuple[Decimal, Decimal]] = {}
    by_unit: dict[str, Decimal] = {}
    meters: list[dict[str, object]] = []
    for meter in configured_meters(config):
        value = nonnegative_of(row, meter.column)
        standard = value * meter.standard_coal_factor
        previous, coal = grouped.get(
            (meter.category, meter.unit), (Decimal(0), Decimal(0))
        )
        grouped[(meter.category, meter.unit)] = (
            previous + value,
            coal + standard,
        )
        by_unit[meter.unit] = by_unit.get(meter.unit, Decimal(0)) + value
        meters.append(
            _meter_detail(
                meter, value, standard, config.parameters.decimal_places
            )
        )
    total = sum((coal for _, coal in grouped.values()), Decimal(0))
    return {
        "meters": meters,
        "breakdown": [
            {
                "category": category,
                "unit": unit,
                "value": decimal_text(value, config.parameters.decimal_places),
                "standard_coal_kg": decimal_text(
                    coal, config.parameters.decimal_places
                ),
            }
            for (category, unit), (value, coal) in grouped.items()
        ],
        "totals_by_unit": {
            unit: decimal_text(value, config.parameters.decimal_places)
            for unit, value in by_unit.items()
        },
        "total_standard_coal_kg": decimal_text(
            total, config.parameters.decimal_places
        ),
        "factor_source": "model_configuration",
        "summary_value": float(total),
    }


def _meter_detail(
    meter: EnergyMeter, value: Decimal, standard: Decimal, places: int
) -> dict[str, object]:
    return {
        "column": meter.column,
        "category": meter.category,
        "unit": meter.unit,
        "value": decimal_text(value, places),
        "standard_coal_factor": str(meter.standard_coal_factor),
        "standard_coal_kg": decimal_text(standard, places),
    }
