"""服务端工具在执行前校验参数，失败提示说明状态与恢复方式。"""

import json
from pathlib import Path
from typing import Any

import pytest

from ai_assistant.apps.chat.services.intent.select import specs_for
from ai_assistant.apps.chat.services.tools.execution import (
    ToolExecutionError,
    ToolExecutor,
    validate_arguments,
)
from ai_assistant.apps.chat.services.tools.guides import OUTPUT_GUIDES
from ai_assistant.apps.chat.services.tools.providers.server import ServerTools
from ai_assistant.apps.chat.services.tools.specs import TOOL_SPECS
from ai_assistant.apps.chat.skills import default_catalog
from llmcore.tools.shapes import ToolSpec


async def _must_not_run(name: str, arguments: dict[str, Any]) -> object:
    raise AssertionError(f"不应调用业务工具 {name}：{arguments}")


def test_config_path_accepts_the_browser_array_index_fixture() -> None:
    fixture = json.loads(
        (Path(__file__).parents[1] / "fixtures/config_path.json").read_text()
    )
    spec = next(one for one in TOOL_SPECS if one.name == fixture["name"])
    validate_arguments(spec, fixture["arguments"])
    assert fixture["arguments"]["path"] == ["indicators", 0, "name"]


@pytest.mark.parametrize("path", [[], ["indicators", -1], [True], [0.5]])
def test_config_path_rejects_invalid_field_or_index_segments(
    path: list[object],
) -> None:
    spec = next(one for one in TOOL_SPECS if one.name == "dashboard.set_config")
    with pytest.raises(ToolExecutionError):
        validate_arguments(spec, {"node_id": "radar", "path": path, "value": 1})


def _executor() -> ToolExecutor:
    skills = default_catalog().select(
        "twin-editor", codes=frozenset({"dashboard:edit"})
    )
    return ToolExecutor(
        specs_for("twin-editor", [], skills=skills), skills, _must_not_run
    )


@pytest.mark.parametrize(
    ("name", "arguments"),
    [
        ("points.detail", {}),
        ("points.detail", {"node_key": 42}),
        ("points.detail", {"node_key": "a:b", "extra": True}),
        (
            "skills.read_resource",
            {"name": "twin-configure", "path": "x", "limit": True},
        ),
    ],
)
async def test_schema_errors_are_returned_before_execution(
    name: str, arguments: dict[str, Any]
) -> None:
    with pytest.raises(ToolExecutionError) as caught:
        await _executor()(name, arguments)
    result = json.loads(str(caught.value))
    assert result["code"] == "invalid_arguments"
    assert result["execution"] == "not_started"
    assert "修正" in result["next_action"]


async def test_skill_load_enforces_the_current_page_and_permission_scope() -> (
    None
):
    with pytest.raises(ToolExecutionError, match="可用技能"):
        await _executor()("skills.load", {"name": "formula-author"})
    result = await _executor()("skills.load", {"name": "twin-configure"})
    assert result["name"] == "twin-configure"
    assert "references/entity-contracts.md" in result["resources"]
    assert "## 部件的易错口径" not in result["instructions"]


async def test_describe_uses_the_actual_tool_schema_and_output_semantics() -> (
    None
):
    result = await _executor()("tools.describe", {"name": "points.detail"})
    assert result["input_schema"]["required"] == ["node_key"]
    assert "点位" in result["output"]
    assert result["runs_on"] == "server"


def test_every_builtin_tool_has_a_result_guide() -> None:
    assert {spec.name for spec in TOOL_SPECS} == {
        name for name, _ in OUTPUT_GUIDES
    }


async def test_chunk_window_never_clips_while_claiming_end() -> None:
    async def read(_name: str, _arguments: dict[str, Any]) -> object:
        return {"text": "原文" * 2000, "has_more": False, "next_offset": None}

    executor = ToolExecutor(TOOL_SPECS, (), read, result_reserve_chars=512)
    with pytest.raises(ToolExecutionError, match="完整"):
        await executor.run_with_budget(
            "knowledge.read_chunk", {"base_id": "b", "chunk_id": "c"}, 1000
        )


@pytest.mark.parametrize("error_type", [RuntimeError, ValueError])
async def test_execution_failure_keeps_unknown_state_and_hides_raw_details(
    error_type: type[Exception],
) -> None:
    async def failed(_name: str, _arguments: dict[str, Any]) -> object:
        raise error_type("postgres://password@private")

    executor = ToolExecutor(TOOL_SPECS, (), failed)
    with pytest.raises(ToolExecutionError) as caught:
        await executor(
            "memory.remember", {"title": "口径", "body": "日统计用业务时区"}
        )
    result = json.loads(str(caught.value))
    assert result["execution"] == "unknown"
    assert result["retryable"] is False
    assert "private" not in str(caught.value)


async def test_known_parameter_errors_keep_the_repair_instruction() -> None:
    executor = ToolExecutor(TOOL_SPECS, (), ServerTools().run)
    with pytest.raises(ToolExecutionError) as caught:
        await executor("points.detail", {"node_key": "bad"})
    result = json.loads(str(caught.value))
    assert "数据源id" in result["message"]
    assert result["execution"] == "not_started"


async def test_schema_external_references_never_open_a_network_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    visited: list[str] = []

    def unsafe_open(url: str) -> object:
        visited.append(url)
        raise AssertionError("schema 校验不应访问网络")

    monkeypatch.setattr("urllib.request.urlopen", unsafe_open)
    spec = ToolSpec(
        name="mcp.demo.read",
        description="读取",
        parameters={"$ref": "https://example.test/schema.json"},
        runs_on="server",
    )
    executor = ToolExecutor((spec,), (), _must_not_run)
    with pytest.raises(ToolExecutionError) as caught:
        await executor(spec.name, {})
    result = json.loads(str(caught.value))
    assert result["code"] == "invalid_tool_schema"
    assert visited == []
