"""助手语义候选模型与平台 OpenAPI、工具指引保持一致。"""

import json
from pathlib import Path

from ai_assistant.apps.chat.services.tools.providers.server_specs import (
    SERVER_SPECS,
)
from ai_assistant.upstream.point_matches import PointMatch, PointMatches


def test_point_search_models_match_platform_openapi() -> None:
    path = Path(__file__).parents[3] / "platform-server" / "openapi.json"
    schemas = json.loads(path.read_text())["components"]["schemas"]
    for model, name in (
        (PointMatch, "PointMatchOut"),
        (PointMatches, "PointMatchesOut"),
    ):
        actual = model.model_json_schema()
        expected = schemas[name]
        assert actual["properties"].keys() == expected["properties"].keys()
        assert set(actual["required"]) == set(expected["required"])
        for key, value in actual["properties"].items():
            if key != "items":
                assert value.get("type") == expected["properties"][key].get(
                    "type"
                )
                assert value.get("anyOf") == expected["properties"][key].get(
                    "anyOf"
                )
                assert value.get("enum") == expected["properties"][key].get(
                    "enum"
                )


def test_tool_describes_semantics_and_upstream_bounds() -> None:
    spec = next(one for one in SERVER_SPECS if one.name == "points.search")
    assert "语义" in spec.description
    assert "points.detail" in spec.description
    assert spec.parameters["properties"]["keyword"]["maxLength"] == 300
    assert spec.parameters["properties"]["limit"]["maximum"] == 12
