"""确认整批和逐项工具预算在执行动作前得到遵守。"""

from collections.abc import Sequence
from dataclasses import replace
from typing import Any

import pytest
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from unit.fakes import ScriptedResponder, tool_call

from llmcore.errors import ModelRejected
from llmcore.tools.shapes import ToolSpec
from llmcore.turn import TurnDeps, run_turn

SEARCH = ToolSpec(
    name="kb.search",
    description="检索",
    parameters={"type": "object", "properties": {}},
    runs_on="server",
)


async def test_an_oversized_tool_batch_is_refused_before_execution() -> None:
    calls = [
        tool_call("kb.search", {}, "one"),
        tool_call("kb.search", {}, "two"),
    ]
    model = ScriptedResponder([AIMessage(content="", tool_calls=calls)])
    executed: list[str] = []

    async def execute(name: str, _arguments: dict[str, Any]) -> object:
        executed.append(name)
        return "结果"

    deps = replace(
        TurnDeps(model=model, specs=(SEARCH,), run_tool=execute),
        remaining_tool_chars=lambda _messages, _tools: 700,
    )
    with pytest.raises(ModelRejected, match="本批工具"):
        await run_turn(deps, [])
    assert executed == []


async def test_depleted_budget_stops_before_the_next_call() -> None:
    calls = [
        tool_call("kb.search", {"page": page}, str(page)) for page in (1, 2)
    ]
    model = ScriptedResponder(
        [AIMessage(content="", tool_calls=calls), AIMessage(content="完成")]
    )
    executed: list[int] = []

    async def execute(_name: str, arguments: dict[str, Any]) -> str:
        executed.append(arguments["page"])
        return "已执行"

    def remaining(
        messages: Sequence[BaseMessage], _tools: Sequence[dict[str, Any]]
    ) -> int:
        return (
            350
            if any(isinstance(one, ToolMessage) for one in messages)
            else 1200
        )

    with pytest.raises(ModelRejected, match="剩余"):
        await run_turn(
            replace(
                TurnDeps(model=model, specs=(SEARCH,), run_tool=execute),
                remaining_tool_chars=remaining,
            ),
            [],
        )
    assert executed == [1]
