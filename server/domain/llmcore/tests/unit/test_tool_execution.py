"""共享工具执行边界在调用前校验，执行后如实报告结果是否已知。"""

import json
from typing import Any

import pytest

from lib.errors import AppError
from llmcore.tools.execution import ToolExecutionError, ToolExecutor, failure
from llmcore.tools.ports import UnknownTool
from llmcore.tools.shapes import ToolSpec, object_schema, string_schema

SPEC = ToolSpec(
    name="records.read",
    description="Read one record",
    parameters=object_schema({"id": string_schema("Record ID")}, ["id"]),
    runs_on="server",
)


@pytest.mark.parametrize(
    ("error", "code", "execution"),
    [
        (UnknownTool("invalid identity"), "invalid_arguments", "not_started"),
        (
            AppError("record unavailable"),
            "dependency_or_business_error",
            "unknown",
        ),
        (
            RuntimeError("postgres://private-password@host"),
            "tool_failed",
            "unknown",
        ),
        (
            failure(
                "out_of_scope", "outside scope", "select a permitted record"
            ),
            "out_of_scope",
            "not_started",
        ),
    ],
)
async def test_failure_reports_repair_and_never_leaks_unexpected_details(
    error: Exception, code: str, execution: str
) -> None:
    async def run(_name: str, _args: dict[str, Any]) -> object:
        raise error

    with pytest.raises(ToolExecutionError) as caught:
        await ToolExecutor((SPEC,), (), run).run_with_budget(
            "records.read", {"id": "one"}, 500
        )
    result = json.loads(str(caught.value))
    assert result["code"] == code
    assert result["execution"] == execution
    assert result["retryable"] is False
    assert result["next_action"]
    assert "private-password" not in str(caught.value)


async def test_schema_failure_does_not_execute_or_fetch_external_references(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run(_name: str, _args: dict[str, Any]) -> object:
        raise AssertionError("The runner must not start")

    def fetch(_url: object) -> object:
        raise AssertionError("Network access is forbidden during validation")

    monkeypatch.setattr("urllib.request.urlopen", fetch)
    external = ToolSpec(
        name="records.read",
        description="read",
        parameters={"$ref": "https://example.test/private-schema"},
        runs_on="server",
    )
    with pytest.raises(ToolExecutionError, match="invalid_tool_schema"):
        await ToolExecutor((external,), (), run)(external.name, {})
    with pytest.raises(ToolExecutionError, match="invalid_arguments"):
        await ToolExecutor((SPEC,), (), run)(SPEC.name, {"id": 42})


async def test_valid_call_preserves_the_business_result() -> None:
    async def run(_name: str, arguments: dict[str, Any]) -> object:
        return {"id": arguments["id"], "value": "observed"}

    assert await ToolExecutor((SPEC,), (), run)(SPEC.name, {"id": "one"}) == {
        "id": "one",
        "value": "observed",
    }
