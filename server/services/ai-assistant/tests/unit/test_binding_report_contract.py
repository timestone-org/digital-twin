"""绑定清单工具必须声明筛选与有界续读，保留旧调用方式。"""

import pytest
from jsonschema import Draft202012Validator

from ai_assistant.apps.chat.services.tools.providers.client_specs.core import (
    CLIENT_SPECS,
)


def test_binding_report_declares_filters_and_continuation() -> None:
    spec = next(s for s in CLIENT_SPECS if s.name == "dashboard.read_bindings")
    properties = spec.parameters["properties"]
    assert set(properties) == {
        "node_id",
        "slot_key",
        "entity_id",
        "keyword",
        "offset",
        "limit",
    }
    assert spec.parameters["required"] == ["node_id"]
    assert properties["limit"]["maximum"] == 20
    assert properties["limit"]["minimum"] == 1
    assert properties["offset"]["minimum"] == 0
    assert "next_offset" in spec.description
    assert "读完" in spec.description


@pytest.mark.parametrize(
    "arguments",
    [
        {"node_id": "n1"},
        {
            "node_id": "n1",
            "entity_id": "chiller-1",
            "slot_key": "partFieldValues",
            "keyword": "温度",
            "offset": 20,
            "limit": 20,
        },
        {"node_id": "n1", "entity_id": None, "slot_key": "", "keyword": None},
    ],
)
def test_binding_report_accepts_supported_filters(
    arguments: dict[str, object],
) -> None:
    spec = next(s for s in CLIENT_SPECS if s.name == "dashboard.read_bindings")
    assert Draft202012Validator(spec.parameters).is_valid(arguments)


@pytest.mark.parametrize(
    "arguments",
    [
        {"offset": -1},
        {"offset": 0.5},
        {"offset": True},
        {"offset": "1"},
        {"limit": 0},
        {"limit": 21},
        {"limit": 1.5},
        {"limit": True},
        {"slot_key": []},
        {"entity_id": {}},
        {"keyword": 1},
    ],
)
def test_binding_report_rejects_invalid_window(
    arguments: dict[str, object],
) -> None:
    spec = next(s for s in CLIENT_SPECS if s.name == "dashboard.read_bindings")
    assert not Draft202012Validator(spec.parameters).is_valid(
        {"node_id": "n1", **arguments}
    )
