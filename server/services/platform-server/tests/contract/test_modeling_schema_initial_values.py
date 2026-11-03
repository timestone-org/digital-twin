"""浏览器从算子schema构造的初值与后端真实默认保持一致。"""

from copy import deepcopy
from typing import Any, cast

import pytest

from platform_server.apps.modeling.operators import registry

FAMILY_CODES = (
    "regression_model",
    "classification_model",
    "clustering_analysis",
    "anomaly_model",
)


def frontend_defaults(schema: dict[str, Any]) -> dict[str, object]:
    """按共享schemaForm.defaultsOf的控件空值口径构造配置。Args: schema。"""
    properties = cast(dict[str, dict[str, Any]], schema["properties"])
    defaults: dict[str, object] = {}
    for key, raw_field in properties.items():
        field = _resolved(schema, raw_field)
        if "default" in field:
            defaults[key] = deepcopy(field["default"])
            continue
        kind = field.get("type")
        if kind == "array":
            defaults[key] = []
        elif kind == "boolean":
            defaults[key] = False
        elif kind in {"integer", "number"}:
            defaults[key] = None
        else:
            defaults[key] = ""
    return defaults


def _resolved(schema: dict[str, Any], field: dict[str, Any]) -> dict[str, Any]:
    reference = field.get("$ref")
    if not isinstance(reference, str):
        return field
    return {**schema["$defs"][reference.rsplit("/", 1)[-1]], **field}


@pytest.mark.parametrize("code", FAMILY_CODES)
def test_every_family_algorithm_accepts_browser_initial_values(
    code: str,
) -> None:
    model = registry.get(code).CONFIG_MODEL
    schema = model.model_json_schema()
    defaults = frontend_defaults(schema)
    for algorithm in _resolved(schema, schema["properties"]["algorithm"])[
        "enum"
    ]:
        configured = defaults | {"algorithm": algorithm}
        parsed = model.model_validate(configured)
        assert (
            parsed.model_dump()
            == model.model_validate({"algorithm": algorithm}).model_dump()
        )


@pytest.mark.parametrize("code", registry.codes())
def test_nonempty_factory_lists_publish_their_true_schema_default(
    code: str,
) -> None:
    model = registry.get(code).CONFIG_MODEL
    properties = cast(
        dict[str, dict[str, Any]], model.model_json_schema()["properties"]
    )
    for name, field in model.model_fields.items():
        if field.default_factory is None:
            continue
        actual: object = field.get_default(call_default_factory=True)
        if isinstance(actual, list) and actual:
            assert properties[name].get("default") == actual, f"{code}.{name}"


def test_mlp_default_is_independent_between_instances_and_matches_schema() -> (
    None
):
    config = registry.get("regression_model").CONFIG_MODEL
    first = config.model_validate({}).model_dump()
    second = config.model_validate({}).model_dump()
    assert first["hidden_layers"] == second["hidden_layers"] == [64, 32]
    first["hidden_layers"].append(7)
    assert second["hidden_layers"] == [64, 32]
    assert config.model_json_schema()["properties"]["hidden_layers"][
        "default"
    ] == [64, 32]
