"""算子目录中的配置默认值必须与缺省执行口径一致。"""

import pytest
from pydantic import ValidationError

from contract.test_modeling_report_coverage import cases
from platform_server.apps.modeling.operators import registry


@pytest.mark.parametrize(
    ("code", "key", "expected"),
    [
        ("cyclic_time", "cycles", ["day", "week"]),
        ("time_feature", "parts", ["hour"]),
        ("rolling_feature", "stats", ["mean"]),
        ("lag_feature", "lags", [1]),
        ("ledger_source", "columns", []),
    ],
)
def test_factory_defaults_are_part_of_the_operator_schema(
    code: str, key: str, expected: object
) -> None:
    schema = registry.get(code).spec().config_schema
    assert schema["properties"][key].get("default") == expected


def test_nested_rule_parameters_expose_the_effective_defaults() -> None:
    schema = registry.get("energy_rules").spec().config_schema
    defaults = schema["properties"]["parameters"].get("default", {})
    assert defaults.get("temperature_min") == 18
    assert defaults.get("flow_max") == 120


def test_required_references_do_not_invent_an_empty_default() -> None:
    schema = registry.get("ledger_source").spec().config_schema
    assert "table_code" in schema["required"]
    assert "default" not in schema["properties"]["table_code"]


def test_schema_defaults_do_not_share_mutable_state() -> None:
    operator = registry.get("cyclic_time")
    first = operator.spec().config_schema
    first["properties"]["cycles"].get("default", []).append("invalid")
    second = operator.spec().config_schema
    assert second["properties"]["cycles"].get("default") == ["day", "week"]


def test_lag_items_expose_the_same_limits_as_execution() -> None:
    schema = registry.get("lag_feature").spec().config_schema
    item = schema["properties"]["lags"]["items"]
    assert item.get("minimum") == 1
    assert item.get("maximum") == 100


@pytest.mark.parametrize("code", registry.codes())
def test_all_operator_defaults_match_normal_configuration_parsing(
    code: str,
) -> None:
    operator = registry.get(code)
    required = operator.CONFIG_MODEL.model_json_schema().get("required", [])
    supplied = cases()[code][1]
    parsed = operator.CONFIG_MODEL.model_validate(
        {key: supplied[key] for key in required}
    ).model_dump(mode="json", by_alias=True)
    schema = operator.spec().config_schema
    for key, value in parsed.items():
        if key not in required:
            assert schema["properties"][key]["default"] == value, (code, key)


@pytest.mark.parametrize(
    ("code", "config"),
    [
        ("fill_missing", {"value": "Infinity"}),
        ("filter_rows", {"column": "能耗", "value": "NaN"}),
        ("classification_metrics", {"positive_label": "NaN"}),
        ("linear_regression", {"ridge_alpha": "Infinity"}),
        ("logistic_regression", {"regularization_strength": "Infinity"}),
        ("clip_outlier", {"threshold": "Infinity"}),
    ],
)
def test_numeric_operator_configuration_rejects_nonfinite_values(
    code: str, config: dict[str, object]
) -> None:
    with pytest.raises(ValidationError, match="finite_number"):
        registry.build(code, config)
