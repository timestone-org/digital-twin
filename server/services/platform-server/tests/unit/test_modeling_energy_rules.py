"""能源规则计算的精确口径、配置边界与模型封存契约。"""

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    ModelPayload,
    OperatorConfig,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.energy_rules import (
    EnergyRules,
    EnergyRulesConfig,
    evaluate_energy_rule,
    required_columns,
)


def calculate(
    kind: str, row: dict[str, object], **options: object
) -> dict[str, object]:
    config = EnergyRulesConfig.model_validate({"kind": kind, **options})
    return evaluate_energy_rule(config, row)


def test_hvac_compliance_uses_inclusive_limits_and_named_reasons() -> None:
    result = calculate("hvac_compliance", {"温度": 26, "湿度": 40})
    assert result["is_compliant"] is True
    assert result["violations"] == []
    outside = calculate("hvac_compliance", {"温度": 27, "湿度": 70})
    assert outside["violations"] == ["temperature_high", "humidity_high"]


def test_fluctuation_keeps_signed_change_and_absolute_threshold() -> None:
    result = calculate(
        "efficiency_fluctuation", {"当前能效": "2.7", "基准能效": "3"}
    )
    assert result["change_pct"] == "-10"
    assert result["is_fluctuating"] is False
    assert (
        calculate(
            "efficiency_fluctuation", {"当前能效": "2.6", "基准能效": "3"}
        )["is_fluctuating"]
        is True
    )


def test_aggregation_keeps_units_separate_and_sums_exact_coal_equivalents() -> (
    None
):
    result = calculate(
        "energy_aggregation",
        {"动力": "0.1", "照明": "0.2", "燃气": "1.5"},
        meters=[
            {
                "category": "电力",
                "column": "动力",
                "unit": "kWh",
                "standard_coal_factor": "0.1229",
            },
            {
                "category": "电力",
                "column": "照明",
                "unit": "kWh",
                "standard_coal_factor": "0.1229",
            },
            {
                "category": "燃气",
                "column": "燃气",
                "unit": "m³",
                "standard_coal_factor": "1.33",
            },
        ],
    )
    assert result["totals_by_unit"] == {"kWh": "0.3", "m³": "1.5"}
    assert result["total_standard_coal_kg"] == "2.03187"
    breakdown = result["breakdown"]
    assert isinstance(breakdown, list)
    assert len(breakdown) == 2


def test_unit_consumption_is_decimal_calculation_without_training() -> None:
    result = calculate("unit_consumption", {"能耗": "0.3", "产量": "0.1"})
    assert result["unit_consumption"] == "3"
    assert result["calculation_method"] == "deterministic_rule"


def test_benchmark_and_equipment_efficiency_preserve_business_meaning() -> None:
    compared = calculate(
        "efficiency_benchmark", {"实际单位能耗": "1.1", "对标单位能耗": "1"}
    )
    assert compared["deviation_pct"] == "10"
    assert compared["grade"] == "attention"
    equipment = calculate(
        "equipment_efficiency", {"制冷量": "800", "输入功率": "200"}
    )
    assert equipment["cop"] == "4"
    assert equipment["grade"] == "efficient"


def test_supply_diagnosis_only_names_rules_supported_by_measurements() -> None:
    result = calculate(
        "supply_diagnosis", {"电压": 200, "频率": 51, "压力": 0.4, "流量": 125}
    )
    assert result["diagnosis_codes"] == [
        "undervoltage",
        "overfrequency",
        "low_pressure",
        "high_flow",
    ]
    assert result["is_abnormal"] is True
    assert result["diagnostic_scope"] == "measured_limit_violation"


def test_trace_exposes_paths_losses_and_internal_node_imbalance() -> None:
    result = calculate(
        "energy_trace",
        {"供入": 100, "生产": 60, "空调": 30},
        topology=[
            {
                "source": "电网",
                "target": "配电",
                "column": "供入",
                "efficiency": "0.9",
            },
            {"source": "配电", "target": "生产", "column": "生产"},
            {"source": "配电", "target": "空调", "column": "空调"},
        ],
    )
    assert result["is_balanced"] is True
    assert result["total_supply"] == "100"
    assert result["total_consumption"] == "90"
    assert result["total_edge_loss"] == "10"
    assert result["conservation_residual"] == "0"
    assert result["paths"] == [
        ["电网", "配电", "生产"],
        ["电网", "配电", "空调"],
    ]
    unbalanced = calculate(
        "energy_trace",
        {"总供能": 100, "生产供能": 60, "空调供能": 30, "照明供能": 20},
    )
    assert unbalanced["is_balanced"] is False
    assert unbalanced["total_node_imbalance"] == "-10"


@pytest.mark.parametrize(
    "bad", [None, True, "bad", "NaN", "Infinity", float("inf"), 1e101]
)
def test_invalid_inputs_never_become_valid_rule_results(bad: object) -> None:
    with pytest.raises(OperatorError):
        calculate("unit_consumption", {"能耗": bad, "产量": 10})


@pytest.mark.parametrize(
    ("kind", "row"),
    [
        ("unit_consumption", {"能耗": 100, "产量": 0}),
        ("equipment_efficiency", {"制冷量": 100, "输入功率": 0}),
        ("efficiency_benchmark", {"实际单位能耗": 1, "对标单位能耗": 0}),
        ("efficiency_fluctuation", {"当前能效": 1, "基准能效": 0}),
        ("unit_consumption", {"能耗": -1, "产量": 1}),
        ("unit_consumption", {"产量": 1}),
    ],
)
def test_undefined_or_negative_accounting_is_rejected(
    kind: str, row: dict[str, object]
) -> None:
    with pytest.raises(OperatorError):
        calculate(kind, row)


@pytest.mark.parametrize(
    "config",
    [
        {"kind": "unknown"},
        {"parameters": {"temperature_min": 30, "temperature_max": 20}},
        {"parameters": {"decimal_places": 20}},
        {"fields": {"unknown": "字段"}},
        {
            "meters": [
                {
                    "category": "电",
                    "column": "能耗",
                    "standard_coal_factor": "-1",
                }
            ]
        },
        {"topology": [{"source": "甲", "target": "甲", "column": "能量"}]},
        {
            "topology": [
                {"source": "甲", "target": "乙", "column": "能量"},
                {"source": "乙", "target": "甲", "column": "返流"},
            ]
        },
        {
            "meters": [
                {"category": "电", "column": "电量"},
                {"category": "电", "column": "电量"},
            ]
        },
    ],
)
def test_malformed_rule_configuration_fails_before_running(
    config: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        EnergyRulesConfig.model_validate(config)


def test_rule_model_needs_no_split_and_preserves_configuration() -> None:
    operator, _ = registry.build("energy_rules", {"kind": "unit_consumption"})
    assert isinstance(operator, EnergyRules)
    frame = Frame(
        columns=tuple(
            FrameColumn(key=key, name=key, dtype="number")
            for key in ("能耗", "产量")
        ),
        rows=((100.0, 20.0), (120.0, 30.0)),
    )
    assert operator.report() == ()
    payload = operator.run({"frame": frame})["model"]
    assert isinstance(payload, ModelPayload)
    assert payload.task == "rule_calculation"
    assert payload.target_key is None
    assert payload.feature_keys == ("能耗", "产量")
    assert operator.predict_rows(frame) == [5.0, 4.0]
    fitted = operator.dump_fitted()
    assert fitted is not None
    restored, _ = registry.build("energy_rules", {})
    restored.load_fitted(fitted)
    assert isinstance(restored, EnergyRules)
    assert restored.calculate_rows(frame) == operator.calculate_rows(frame)
    assert operator.report()


def test_custom_field_mapping_keeps_signature_order() -> None:
    config = EnergyRulesConfig(
        kind="unit_consumption",
        fields={"energy": "有功电量", "output": "合格产量"},
    )
    assert required_columns(config) == ("有功电量", "合格产量")
    assert (
        evaluate_energy_rule(config, {"有功电量": 50, "合格产量": 10})[
            "unit_consumption"
        ]
        == "5"
    )


def test_operator_refuses_empty_frames_and_broken_fitted_config() -> None:
    operator, _ = registry.build("energy_rules", {})
    with pytest.raises(OperatorError):
        operator.run({"frame": Frame(columns=(), rows=())})
    with pytest.raises(OperatorError):
        operator.load_fitted({"config": {"kind": "unknown"}})
    with pytest.raises(OperatorError):
        operator.load_fitted({})


@pytest.mark.parametrize(
    "config",
    [
        {"parameters": {"benchmark_good_ratio": 2}},
        {"fields": {"temperature": " "}},
        {"fields": {"temperature": "a" * 129}},
        {"fields": {"temperature": "湿度"}},
        {
            "topology": [
                {"source": "甲", "target": "乙", "column": "甲"},
                {"source": "甲", "target": "乙", "column": "乙"},
            ]
        },
        {
            "topology": [
                {"source": "甲", "target": "乙", "column": "甲", "unit": "kWh"},
                {"source": "乙", "target": "丙", "column": "乙", "unit": "kJ"},
            ]
        },
        {
            "meters": [
                {
                    "category": "电",
                    "column": "电量",
                    "standard_coal_factor": "NaN",
                }
            ]
        },
        {
            "topology": [
                {
                    "source": "甲",
                    "target": "乙",
                    "column": "能量",
                    "efficiency": "0",
                }
            ]
        },
        {
            "topology": [
                {
                    "source": f"节点{index}",
                    "target": f"节点{index + 1}",
                    "column": f"值{index}",
                }
                for index in range(32)
            ]
        },
    ],
)
def test_rule_configuration_rejects_ambiguous_units_and_unbounded_graphs(
    config: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        EnergyRulesConfig.model_validate(config)


def test_normal_supply_and_every_efficiency_grade_are_observable() -> None:
    assert (
        calculate(
            "supply_diagnosis",
            {"电压": 220, "频率": 50, "压力": 0.6, "流量": 100},
        )["diagnosis_codes"]
        == []
    )
    assert (
        calculate(
            "efficiency_benchmark", {"实际单位能耗": 1, "对标单位能耗": 1}
        )["grade"]
        == "good"
    )
    assert (
        calculate(
            "efficiency_benchmark", {"实际单位能耗": 1.2, "对标单位能耗": 1}
        )["grade"]
        == "inefficient"
    )
    assert (
        calculate("equipment_efficiency", {"制冷量": 500, "输入功率": 200})[
            "grade"
        ]
        == "inefficient"
    )


def test_defaults_define_all_meter_inputs_and_preserve_zero_readings() -> None:
    aggregate = EnergyRulesConfig(kind="energy_aggregation")
    assert required_columns(aggregate) == ("生产电量", "空调电量", "照明电量")
    assert (
        evaluate_energy_rule(
            aggregate, {"生产电量": 0, "空调电量": 0, "照明电量": 0}
        )["total_standard_coal_kg"]
        == "0"
    )
    trace = EnergyRulesConfig(kind="energy_trace")
    assert required_columns(trace) == (
        "总供能",
        "生产供能",
        "空调供能",
        "照明供能",
    )


def test_rounding_is_frozen_and_tiny_denominators_are_refused() -> None:
    assert (
        calculate(
            "unit_consumption",
            {"能耗": 1, "产量": 3},
            parameters={"decimal_places": 3},
        )["unit_consumption"]
        == "0.333"
    )
    assert (
        calculate(
            "unit_consumption",
            {"能耗": 5, "产量": 2},
            parameters={"decimal_places": 0},
        )["unit_consumption"]
        == "3"
    )
    with pytest.raises(OperatorError):
        calculate("unit_consumption", {"能耗": 1, "产量": "1e-100"})


def test_operator_refuses_missing_duplicate_and_misaligned_columns() -> None:
    operator, _ = registry.build("energy_rules", {})
    assert isinstance(operator, EnergyRules)
    assert EnergyRules.describe_columns(
        EnergyRulesConfig(), {"frame": ("温度", "湿度")}
    ) == {
        "scored": ("rule_value",),
        "details": ("is_compliant", "violations", "observations"),
    }
    columns = tuple(
        FrameColumn(key=key, name=key, dtype="number")
        for key in ("温度", "湿度")
    )
    for frame in (
        Frame(columns=(), rows=((1.0,),)),
        Frame(columns=(*columns, columns[0]), rows=((24.0, 50.0, 25.0),)),
        Frame(columns=columns, rows=((24.0,),)),
    ):
        with pytest.raises(OperatorError):
            operator.calculate_rows(frame)
    with pytest.raises(OperatorError):
        EnergyRules(OperatorConfig()).input_columns()


def test_trace_supports_merging_metered_flows_and_rejects_path_explosion() -> (
    None
):
    topology = [
        {"source": "电网", "target": "母线", "column": "购电"},
        {"source": "光伏", "target": "母线", "column": "发电"},
        {"source": "母线", "target": "负荷", "column": "用电"},
    ]
    result = calculate(
        "energy_trace", {"购电": 80, "发电": 20, "用电": 100}, topology=topology
    )
    assert result["is_balanced"] is True
    assert result["paths"] == [
        ["电网", "母线", "负荷"],
        ["光伏", "母线", "负荷"],
    ]
    edges = [
        {
            "source": f"{layer}{side}",
            "target": f"{layer + 1}{target}",
            "column": f"{layer}{side}{target}",
        }
        for layer in range(8)
        for side in ("甲", "乙")
        for target in ("甲", "乙")
    ]
    with pytest.raises(ValidationError, match="路径"):
        EnergyRulesConfig.model_validate(
            {"kind": "energy_trace", "topology": edges}
        )


@pytest.mark.parametrize(
    ("kind", "row", "key", "expected"),
    [
        ("hvac_compliance", {"温度": 24, "湿度": 50}, "is_compliant", True),
        (
            "efficiency_fluctuation",
            {"当前能效": 3.3, "基准能效": 3},
            "change_pct",
            "10",
        ),
        (
            "energy_aggregation",
            {"生产电量": 60, "空调电量": 30, "照明电量": 10},
            "total_standard_coal_kg",
            "12.29",
        ),
        (
            "energy_trace",
            {"总供能": 100, "生产供能": 60, "空调供能": 30, "照明供能": 10},
            "is_balanced",
            True,
        ),
        (
            "unit_consumption",
            {"能耗": 100, "产量": 20},
            "unit_consumption",
            "5",
        ),
        (
            "efficiency_benchmark",
            {"实际单位能耗": 1, "对标单位能耗": 1},
            "grade",
            "good",
        ),
        ("equipment_efficiency", {"制冷量": 800, "输入功率": 200}, "cop", "4"),
        (
            "supply_diagnosis",
            {"电压": 220, "频率": 50, "压力": 0.6, "流量": 100},
            "is_abnormal",
            False,
        ),
    ],
)
def test_business_details_match_static_columns_and_keep_decimal_strings(
    kind: str, row: dict[str, float], key: str, expected: object
) -> None:
    operator, config = registry.build("energy_rules", {"kind": kind})
    source = Frame(
        columns=tuple(
            FrameColumn(key=name, name=name, dtype="number") for name in row
        ),
        rows=(tuple(row.values()),),
    )
    result = operator.run({"frame": source})
    details = result["details"]
    assert isinstance(details, Frame)
    assert (
        details.keys
        == EnergyRules.describe_columns(config, {"frame": source.keys})[
            "details"
        ]
    )
    assert details.rows[0][details.position_of(key)] == expected


def test_long_details_are_marked_without_truncating_deployed_calculation() -> (
    None
):
    meters = [
        {"category": f"类别{index}" + "类" * 40, "column": f"电量{index}"}
        for index in range(32)
    ]
    operator, _ = registry.build(
        "energy_rules", {"kind": "energy_aggregation", "meters": meters}
    )
    assert isinstance(operator, EnergyRules)
    source = Frame(
        columns=tuple(
            FrameColumn(key=f"电量{index}", name=str(index), dtype="number")
            for index in range(32)
        ),
        rows=(tuple(1.0 for _ in range(32)),) * 4,
    )
    result = operator.run({"frame": source})
    details = result["details"]
    assert isinstance(details, Frame)
    assert details.row_count == 4
    cell = details.rows[0][details.position_of("breakdown")]
    assert isinstance(cell, str)
    assert len(cell) <= 1024
    assert "截断" in cell
    complete = operator.calculate_rows(source)[0]["breakdown"]
    assert isinstance(complete, list)
    assert len(complete) == 32
    assert operator.report()[0].payload["after"] == 4


def test_numeric_text_and_frozen_coefficients_are_bounded() -> None:
    with pytest.raises(OperatorError, match="文本过长"):
        calculate("unit_consumption", {"能耗": "1" * 129, "产量": 1})
    with pytest.raises(ValidationError):
        EnergyRulesConfig.model_validate(
            {
                "topology": [
                    {
                        "source": "甲",
                        "target": "乙",
                        "column": "能量",
                        "efficiency": "1e-100",
                    }
                ]
            }
        )


def test_trace_never_hides_opposite_node_errors_in_a_balanced_total() -> None:
    result = calculate(
        "energy_trace",
        {"进线": 100, "中间": 90, "末端": 100},
        topology=[
            {"source": "电网", "target": "母线甲", "column": "进线"},
            {"source": "母线甲", "target": "母线乙", "column": "中间"},
            {"source": "母线乙", "target": "负荷", "column": "末端"},
        ],
    )
    assert result["total_node_imbalance"] == "0"
    assert result["conservation_residual"] == "0"
    assert result["summary_value"] == 20
    assert result["is_balanced"] is False
