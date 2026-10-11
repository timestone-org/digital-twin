"""小窗口完整调用链：技能加载、资源分页与客户端续推均保持可用。"""

import json
from dataclasses import dataclass, field, replace
from typing import Any

import pytest
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from knowledge_server.apps.chat.errors import ChatContextTooLarge
from knowledge_server.apps.chat.services import advance_service as svc
from knowledge_server.apps.chat.services import budget
from knowledge_server.apps.chat.services.context import (
    ContextProjection,
    marked,
)
from knowledge_server.apps.chat.services.scope import ALL_BASES
from knowledge_server.apps.chat.services.tools.client import ASK_SPEC
from knowledge_server.apps.chat.services.tools.collect import COLLECT_SPECS
from knowledge_server.apps.chat.services.tools.guides import describe_tool
from knowledge_server.apps.chat.services.tools.knowledge import KNOWLEDGE_SPECS
from knowledge_server.apps.chat.skills import default_catalog
from llmcore.memory import HistoryRow, history
from llmcore.testing import asks
from llmcore.tools.execution import ToolExecutor
from llmcore.tools.shapes import openai_schema
from llmcore.turn import TurnDeps, run_turn

CLIENTS = ("user.ask", "collect.search_points", "collect.watch_point")


@dataclass
class Model:
    replies: list[AIMessage]
    seen: list[dict[str, Any]] = field(default_factory=list)

    async def respond(self, **kwargs: Any) -> AIMessage:
        self.seen.append(kwargs)
        return self.replies.pop(0)


async def _unused(_name: str, _arguments: dict[str, Any]) -> object:
    raise AssertionError("Only metadata may execute on the server")


def _rows(messages: list[BaseMessage]) -> list[HistoryRow]:
    return [
        HistoryRow(role=role, content_json=content, seq=index)
        for index, message in enumerate(messages)
        for role, content in [history.to_content(message)]
    ]


async def _run(model: Model, payload: svc.AdvanceInput, rows: list[HistoryRow]):
    skills = default_catalog().select()
    specs = svc._turn_specs(
        (*KNOWLEDGE_SPECS, ASK_SPEC, *COLLECT_SPECS), CLIENTS
    )
    messages = svc.assemble(
        payload=payload, rows=rows, summary=None, scope=ALL_BASES
    )
    deps = TurnDeps(
        model=model,
        specs=specs,
        run_tool=ToolExecutor(
            specs,
            skills,
            _unused,
            describe=describe_tool,
            max_skill_chars=budget.result_chars(6656, 20000),
            result_reserve_chars=400,
        ),
        max_context_chars=budget.context_chars(6656),
        max_tool_result_chars=budget.result_chars(6656, 20000),
        prepare_messages=ContextProjection(
            budget.context_chars(6656),
            len(
                json.dumps(
                    [openai_schema(one) for one in specs], ensure_ascii=False
                )
            ),
            skills,
            history.replay(rows),
            878,
        ),
    )
    result = await run_turn(deps, messages)
    for call in model.seen:
        assert len(call["tools"]) == 9
        size = len(json.dumps(call["tools"], ensure_ascii=False)) + sum(
            history.sized(one) for one in call["messages"]
        )
        assert size + 400 < budget.context_chars(6656)
    return messages, result


async def test_skill_load_resource_read_keeps_tools_and_truthful_paging() -> (
    None
):
    model = Model(
        [
            asks("skills.load", "load", name="knowledge-live-data"),
            asks(
                "skills.read_resource",
                "resource",
                name="knowledge-live-data",
                path="references/live-data.md",
            ),
            AIMessage(content="已读本页"),
        ]
    )
    _, result = await _run(
        model,
        svc.AdvanceInput(
            user_text="查余热回收水箱当前温度",
            client_tools=CLIENTS,
        ),
        [],
    )
    receipts = [
        message
        for message in result.messages
        if isinstance(message, ToolMessage)
    ]
    assert len(receipts) == 2
    assert all("已截断" not in str(message.content) for message in receipts)
    assert all(step.state != "failed" for step in result.steps)


def _point_items() -> list[dict[str, str]]:
    return [
        {
            "node_key": (
                "01a05b86-6ea7-7ec6-bda7-4fc9b34f5a20:" f"YR.YR.DB149.REAL40{n}"
            ),
            "name": f"water tank {n} temperature (combined workshop bath tank)",
            "source_name": "3D source",
            "code": f"temperature-{n}",
        }
        for n in range(4)
    ]


async def _searched_history() -> list[HistoryRow]:
    model = Model(
        [
            asks("skills.load", "load", name="knowledge-live-data"),
            asks(
                "collect.search_points",
                "search",
                query="water tank temperature",
            ),
        ]
    )
    seed, result = await _run(
        model,
        svc.AdvanceInput(
            user_text="show the water tank temperature", client_tools=CLIENTS
        ),
        [],
    )
    return _rows([*seed[2:], *result.messages])


def _assert_paired(model: Model) -> None:
    for call in model.seen:
        ids = {
            str(tool["id"])
            for msg in call["messages"]
            if isinstance(msg, AIMessage)
            for tool in msg.tool_calls
        }
        assert all(
            msg.tool_call_id in ids
            for msg in call["messages"]
            if isinstance(msg, ToolMessage)
        )


def _watch_model(keys: list[str]) -> Model:
    return Model(
        [
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "collect.watch_point",
                        "id": f"watch-{n}",
                        "args": {"node_key": key},
                    }
                    for n, key in enumerate(keys)
                ],
            )
        ]
    )


async def test_small_window_completes_live_data_workflow() -> None:
    rows = await _searched_history()
    items = _point_items()
    choose = Model(
        [
            asks(
                "user.ask",
                "choose",
                question="Which tanks?",
                allow_multiple=True,
                options=[
                    {"value": one["node_key"], "label": one["name"]}
                    for one in items
                ],
            )
        ]
    )
    incoming = svc.AdvanceInput(
        tool_results=[
            svc.ClientToolResult(call_id="search", output={"items": items})
        ],
        client_tools=CLIENTS,
    )
    _, asked = await _run(choose, incoming, rows)
    assert asked.pending[0].name == "user.ask"
    rows = _rows(
        [
            *history.replay(rows),
            *svc.incoming_messages(incoming),
            *asked.messages,
        ]
    )
    keys = [items[n]["node_key"] for n in (0, 2)]
    watched = _watch_model(keys)
    payload = svc.AdvanceInput(
        tool_results=[
            svc.ClientToolResult(
                call_id="choose", output={"picked": keys, "is_cancelled": False}
            )
        ],
        client_tools=CLIENTS,
    )
    _, outcome = await _run(watched, payload, rows)
    assert [one.name for one in outcome.pending] == ["collect.watch_point"] * 2
    _assert_paired(choose)
    _assert_paired(watched)


def test_projection_recomputes_skill_restoration_after_history_drops() -> None:
    skill = replace(default_catalog().skills[0], body="约束" * 400)
    load = asks("skills.load", "load", name=skill.name)
    receipt = ToolMessage(
        content=json.dumps({"ok": True, "instructions": skill.body}),
        tool_call_id="load",
    )
    question = HumanMessage(content="当前问题")
    messages = [
        *marked([SystemMessage(content="规则")], "prefix"),
        load,
        receipt,
        AIMessage(content="旧答复" * 1200),
        question,
    ]
    projection = ContextProjection(8000, 4343, (skill,), [], 1000)
    result = projection(messages)
    assert sum(history.sized(one) for one in result) + 4343 + 400 < 8000
    assert question in result
    assert any(
        "已加载技能恢复" in str(one.content) and skill.body in str(one.content)
        for one in result
    )
    assert len(messages) == 5


def test_projection_preserves_a_multi_tool_batch_and_current_question() -> None:
    calls = AIMessage(
        content="",
        tool_calls=[
            {"id": str(n), "name": "kb.search", "args": {}} for n in range(2)
        ],
    )
    replies = [
        ToolMessage(content=f"回执{n}", tool_call_id=str(n)) for n in range(2)
    ]
    question = HumanMessage(content="用户原问题")
    messages = [
        *marked([SystemMessage(content="规则")], "prefix"),
        question,
        AIMessage(content="旧记录" * 1000),
        calls,
        *replies,
    ]
    projection = ContextProjection(1600, 200, (), [])
    result = projection(messages)
    assert question in result
    assert calls in result
    assert all(reply in result for reply in replies)
    assert len(messages) == 6


def test_unknown_budget_keeps_existing_messages() -> None:
    messages = [HumanMessage(content="保留原窗口")]
    assert ContextProjection(0, 0, (), [])(messages) == messages


def test_oversized_current_request_has_an_actionable_failure() -> None:
    with pytest.raises(ChatContextTooLarge, match="缩小查询范围"):
        ContextProjection(900, 500, (), [])([HumanMessage(content="问" * 1000)])


@pytest.mark.parametrize("limit", [7027, 0])
def test_interrupted_old_call_keeps_its_late_filler_with_the_call(
    limit: int,
) -> None:
    cancelled = asks("user.ask", "cancelled", question="旧选择", options=[])
    cancelled.content = "旧说明" * 200
    filler = history.fillers(("cancelled",))[0]
    messages = [
        *marked([SystemMessage(content="规" * 1200)], "prefix"),
        cancelled,
        HumanMessage(content="另一问题"),
        AIMessage(content="答复" * 400),
        filler,
        HumanMessage(content="现在的问题"),
    ]
    result = ContextProjection(limit, 4343, (), [])(messages)
    calls = {
        call["id"]
        for one in result
        if isinstance(one, AIMessage)
        for call in one.tool_calls
    }
    assert all(
        one.tool_call_id in calls
        for one in result
        if isinstance(one, ToolMessage)
    )
    if cancelled in result:
        assert result[result.index(cancelled) + 1] is filler
