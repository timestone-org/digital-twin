"""助手语义候选读取契约兼容平台的先行与完整协议值域。"""

import json
from copy import deepcopy
from pathlib import Path
from typing import Literal, TypedDict, cast

import pytest
from pydantic import ValidationError

from ai_assistant.apps.chat.services.tools.providers.server_specs import (
    SERVER_SPECS,
)
from ai_assistant.upstream.point_matches import PointMatch, PointMatches


class Schema(TypedDict):
    properties: dict[str, dict[str, object]]
    required: list[str]


def read_platform_schemas() -> dict[str, Schema]:
    path = Path(__file__).parents[3] / "platform-server" / "openapi.json"
    return cast(
        "dict[str, Schema]",
        json.loads(path.read_text())["components"]["schemas"],
    )


def assert_matches_schema(actual: Schema, expected: Schema) -> None:
    assert actual["properties"].keys() == expected["properties"].keys()
    assert set(actual["required"]) == set(expected["required"])
    for key, value in actual["properties"].items():
        assert value.get("type") == expected["properties"][key].get("type")
        assert value.get("anyOf") == expected["properties"][key].get("anyOf")
        assert ("const" in value) == ("const" in expected["properties"][key])
        assert json_value_key(value.get("const")) == json_value_key(
            expected["properties"][key].get("const")
        )
        if key == "source_protocol":
            # 读取者先行扩展；完整约定见本服务 ADR-0001。
            produced = expected["properties"][key].get("enum")
            assert isinstance(produced, list)
            assert {"modbus_tcp", "opcua"} <= set(produced)
            assert set(produced) <= {"http", "modbus_tcp", "opcua"}
            assert value.get("enum") == ["http", "modbus_tcp", "opcua"]
        else:
            assert json_value_key(value.get("enum")) == json_value_key(
                expected["properties"][key].get("enum")
            )
        if key == "items":
            assert value.get("items") == {"$ref": "#/$defs/PointMatch"}
            assert expected["properties"][key].get("items") == {
                "$ref": "#/components/schemas/PointMatchOut"
            }


def json_value_key(value: object) -> tuple[str, object]:
    """常量与枚举按 JSON 类型比较，数字保留数学相等语义。"""
    if isinstance(value, bool):
        return ("boolean", value)
    if isinstance(value, (int, float)):
        return ("number", value)
    if isinstance(value, list):
        return (
            "array",
            tuple(json_value_key(one) for one in cast("list[object]", value)),
        )
    if isinstance(value, dict):
        entries = cast("dict[str, object]", value)
        return (
            "object",
            tuple(
                (key, json_value_key(entries[key])) for key in sorted(entries)
            ),
        )
    return (type(value).__name__, value)


def test_point_search_models_match_platform_openapi() -> None:
    schemas = read_platform_schemas()
    for model, name in (
        (PointMatch, "PointMatchOut"),
        (PointMatches, "PointMatchesOut"),
    ):
        assert_matches_schema(
            cast("Schema", model.model_json_schema()), schemas[name]
        )


@pytest.mark.parametrize(
    "protocols",
    [["modbus_tcp", "opcua"], ["http", "modbus_tcp", "opcua"]],
    ids=["legacy-platform", "http-platform"],
)
def test_reader_accepts_legacy_and_http_platform_schemas(
    protocols: list[str],
) -> None:
    schema = deepcopy(read_platform_schemas()["PointMatchOut"])
    schema["properties"]["source_protocol"]["enum"] = protocols
    assert_matches_schema(
        cast("Schema", PointMatch.model_json_schema()), schema
    )


@pytest.mark.parametrize(
    "protocols",
    [["http", "modbus_tcp", "opcua", "mqtt"], ["http", "opcua"]],
    ids=["unknown-protocol", "missing-legacy-protocol"],
)
def test_producer_protocol_drift_is_rejected(protocols: list[str]) -> None:
    schema = deepcopy(read_platform_schemas()["PointMatchOut"])
    schema["properties"]["source_protocol"]["enum"] = protocols
    with pytest.raises(AssertionError):
        assert_matches_schema(
            cast("Schema", PointMatch.model_json_schema()), schema
        )


@pytest.mark.parametrize(
    "protocols",
    [["http", "modbus_tcp", "opcua", "mqtt"], ["http", "opcua"]],
    ids=["unknown-protocol", "missing-legacy-protocol"],
)
def test_reader_protocol_drift_is_rejected(protocols: list[str]) -> None:
    actual = cast("Schema", deepcopy(PointMatch.model_json_schema()))
    actual["properties"]["source_protocol"]["enum"] = protocols
    with pytest.raises(AssertionError):
        assert_matches_schema(actual, read_platform_schemas()["PointMatchOut"])


@pytest.mark.parametrize("drift", ["field", "required", "type", "nullable"])
def test_non_protocol_shape_drift_is_rejected(drift: str) -> None:
    schema = deepcopy(read_platform_schemas()["PointMatchOut"])
    if drift == "field":
        del schema["properties"]["name"]
    elif drift == "required":
        schema["required"].remove("name")
    elif drift == "type":
        schema["properties"]["source_protocol"]["type"] = "integer"
    else:
        schema["properties"]["source_protocol"]["anyOf"] = [{"type": "null"}]
    with pytest.raises(AssertionError):
        assert_matches_schema(
            cast("Schema", PointMatch.model_json_schema()), schema
        )


def test_tool_describes_semantics_and_upstream_bounds() -> None:
    spec = next(one for one in SERVER_SPECS if one.name == "points.search")
    assert "语义" in spec.description
    assert "points.detail" in spec.description
    assert spec.parameters["properties"]["keyword"]["maxLength"] == 300
    assert spec.parameters["properties"]["limit"]["maximum"] == 12


@pytest.mark.parametrize("side", ["producer", "consumer"])
@pytest.mark.parametrize(
    "drift", ["type", "nullable", "item-reference", "enum"]
)
def test_candidate_collection_shape_drift_is_rejected(
    side: str, drift: str
) -> None:
    expected = deepcopy(read_platform_schemas()["PointMatchesOut"])
    actual = cast("Schema", deepcopy(PointMatches.model_json_schema()))
    changed = expected if side == "producer" else actual
    if drift == "type":
        changed["properties"]["items"]["type"] = "string"
    elif drift == "nullable":
        changed["properties"]["items"]["anyOf"] = [{"type": "null"}]
    elif drift == "item-reference":
        changed["properties"]["items"]["items"] = {"$ref": "#/wrong/Point"}
    else:
        changed["properties"]["items"]["enum"] = [[]]
    with pytest.raises(AssertionError):
        assert_matches_schema(actual, expected)


@pytest.mark.parametrize("side", ["producer", "consumer"])
@pytest.mark.parametrize(
    "drift", ["type", "nullable", "enum", "const", "required", "field"]
)
@pytest.mark.parametrize("name", ["PointMatchOut", "PointMatchesOut"])
def test_all_candidate_schema_field_drift_is_rejected(
    side: str, drift: str, name: str
) -> None:
    model = PointMatch if name == "PointMatchOut" else PointMatches
    for field in model.model_fields:
        expected = deepcopy(read_platform_schemas()[name])
        actual = cast("Schema", deepcopy(model.model_json_schema()))
        changed = expected if side == "producer" else actual
        apply_field_drift(changed, field, drift)
        with pytest.raises(AssertionError):
            assert_matches_schema(actual, expected)


def apply_field_drift(schema: Schema, field: str, drift: str) -> None:
    match drift:
        case "field":
            del schema["properties"][field]
        case "required":
            if field in schema["required"]:
                schema["required"].remove(field)
            else:
                schema["required"].append(field)
        case "type":
            original = schema["properties"][field].get("type")
            schema["properties"][field]["type"] = (
                "string" if original == "boolean" else "boolean"
            )
        case "nullable":
            schema["properties"][field]["anyOf"] = [{"type": "null"}]
        case "enum":
            schema["properties"][field]["enum"] = ["unsupported-contract-value"]
        case "const":
            schema["properties"][field]["const"] = "unsupported-contract-value"
        case _:
            pytest.fail("未注册的契约变异类型")


class SingleNamePointMatch(PointMatch):
    """模拟只接受一个候选名称的错误读取契约。"""

    name: Literal["ONLY_NAME"]


@pytest.mark.parametrize("side", ["producer", "consumer"])
def test_single_value_candidate_literals_are_rejected(side: str) -> None:
    single = cast("Schema", SingleNamePointMatch.model_json_schema())
    assert single["properties"]["name"]["const"] == "ONLY_NAME"
    actual = cast("Schema", PointMatch.model_json_schema())
    expected = read_platform_schemas()["PointMatchOut"]
    if side == "producer":
        expected = single
    else:
        actual = single
    with pytest.raises(AssertionError):
        assert_matches_schema(actual, expected)


def test_single_value_literal_rejects_an_ordinary_http_candidate() -> None:
    point = {
        "id": "point",
        "node_key": "source:temperature",
        "code": "temperature",
        "name": "温度",
        "description": None,
        "source_id": "source",
        "source_name": "能源站",
        "source_protocol": "http",
        "unit": "℃",
        "is_enabled": True,
        "is_exact": False,
        "score": 0.9,
    }
    assert PointMatch.model_validate(point).name == "温度"
    with pytest.raises(ValidationError, match="ONLY_NAME"):
        SingleNamePointMatch.model_validate(point)


@pytest.mark.parametrize("side", ["producer", "consumer"])
def test_nullable_field_constant_null_is_rejected(side: str) -> None:
    actual = cast("Schema", deepcopy(PointMatch.model_json_schema()))
    expected = deepcopy(read_platform_schemas()["PointMatchOut"])
    changed = expected if side == "producer" else actual
    assert {"type": "null"} in changed["properties"]["unit"]["anyOf"]
    changed["properties"]["unit"]["const"] = None
    with pytest.raises(AssertionError):
        assert_matches_schema(actual, expected)


@pytest.mark.parametrize("keyword", ["const", "enum"])
@pytest.mark.parametrize(
    ("actual_value", "expected_value"),
    [(True, 1), (False, 0), ([True], [1]), ({"value": True}, {"value": 1})],
    ids=["true-vs-one", "false-vs-zero", "array", "object"],
)
def test_json_constant_and_enum_type_drift_is_rejected(
    keyword: str, actual_value: object, expected_value: object
) -> None:
    actual = cast("Schema", deepcopy(PointMatch.model_json_schema()))
    expected = deepcopy(read_platform_schemas()["PointMatchOut"])
    actual["properties"]["is_enabled"][keyword] = (
        [actual_value] if keyword == "enum" else actual_value
    )
    expected["properties"]["is_enabled"][keyword] = (
        [expected_value] if keyword == "enum" else expected_value
    )
    with pytest.raises(AssertionError):
        assert_matches_schema(actual, expected)


@pytest.mark.parametrize("keyword", ["const", "enum"])
@pytest.mark.parametrize(
    ("actual_value", "expected_value"),
    [
        (None, None),
        (True, True),
        ("温度", "温度"),
        (1, 1.0),
        ([1, {"value": 0}], [1.0, {"value": 0.0}]),
        ({"a": 1, "b": False}, {"b": False, "a": 1.0}),
    ],
    ids=[
        "null",
        "boolean",
        "string",
        "number",
        "nested-number",
        "object-order",
    ],
)
def test_json_constant_and_enum_equal_values_are_accepted(
    keyword: str, actual_value: object, expected_value: object
) -> None:
    actual = cast("Schema", deepcopy(PointMatch.model_json_schema()))
    expected = deepcopy(read_platform_schemas()["PointMatchOut"])
    actual["properties"]["is_enabled"][keyword] = (
        [actual_value] if keyword == "enum" else actual_value
    )
    expected["properties"]["is_enabled"][keyword] = (
        [expected_value] if keyword == "enum" else expected_value
    )
    assert_matches_schema(actual, expected)
