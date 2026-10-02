"""真实测试库回执：逐项结算、取消后不续推、幂等与归属隔离。"""

import uuid
from typing import Any

import pytest
from langchain_core.messages import AIMessage, ToolMessage

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.crud import session_crud
from integration.advance_support import (
    SESSIONS_URL,
    advance,
    install,
    new_session,
)
from integration.conftest import DbStack
from llmcore.testing import ScriptedChat, tool_call

pytestmark = pytest.mark.requires_postgres


async def _pending(stack: DbStack) -> str:
    install(
        stack,
        ScriptedChat(
            script=[
                AIMessage(
                    content="",
                    tool_calls=[
                        tool_call("dashboard.write_binding", "a", node_id="n1"),
                        tool_call("dashboard.write_binding", "b", node_id="n2"),
                    ],
                )
            ]
        ),
    )
    session_id = await new_session(stack.client)
    await advance(stack.client, session_id, user_text="配置测试画布")
    return session_id


async def _messages(stack: DbStack, session_id: str) -> list[dict[str, Any]]:
    response = await stack.client.get(f"{SESSIONS_URL}/{session_id}")
    assert response.status_code == 200
    return list(response.json()["data"]["messages"])


async def test_partial_cancelled_batch_records_only_actual_result_without_model(
    db_stack: DbStack,
) -> None:
    session_id = await _pending(db_stack)
    # pending 的两项都可追踪，不再只有第一项。
    before = await _messages(db_stack, session_id)
    steps = [
        step
        for message in before
        for step in message["steps"]
        if step["kind"] == "client_tool"
    ]
    assert [step["input_json"]["call_id"] for step in steps] == ["a", "b"]
    body = {"tool_results": [{"call_id": "a", "output": {"is_saved": False}}]}
    url = f"{SESSIONS_URL}/{session_id}:receipts"
    for _ in range(2):
        response = await db_stack.client.post(url, json=body)
        assert response.status_code == 200
        assert response.json()["data"] == {"accepted_call_ids": ["a"]}
    messages = await _messages(db_stack, session_id)
    assert (
        len(messages) == len(before) + 1
    )  # 不生成任何模型回复，同值回执只存一次。
    steps = [
        step
        for message in messages
        for step in message["steps"]
        if step["kind"] == "client_tool"
    ]
    assert [step["state"] for step in steps] == ["succeeded", "awaiting_client"]
    assert steps[0]["output_json"]["body"] == '{"is_saved": false}'
    assert len(steps[0]["output_json"]["receipt_sha256"]) == 64
    assert messages[-1]["content_json"]["tool_call_id"] == "a"


async def test_unknown_duplicate_conflict_rejected_atomically(
    db_stack: DbStack,
) -> None:
    session_id = await _pending(db_stack)
    url = f"{SESSIONS_URL}/{session_id}:receipts"
    invalid = [
        [
            {"call_id": "a", "output": "ok"},
            {"call_id": "unknown", "output": "ok"},
        ],
        [{"call_id": "a", "output": "ok"}, {"call_id": "a", "output": "ok"}],
    ]
    before = await _messages(db_stack, session_id)
    for results in invalid:
        response = await db_stack.client.post(
            url, json={"tool_results": results}
        )
        assert response.status_code == 400
        assert await _messages(db_stack, session_id) == before
    response = await db_stack.client.post(
        url, json={"tool_results": [{"call_id": "a", "error": "版本冲突"}]}
    )
    assert response.status_code == 200
    response = await db_stack.client.post(
        url, json={"tool_results": [{"call_id": "a", "output": "ok"}]}
    )
    assert response.status_code == 400
    messages = await _messages(db_stack, session_id)
    steps = [
        step
        for message in messages
        for step in message["steps"]
        if step["kind"] == "client_tool"
    ]
    assert steps[0]["state"] == "failed"
    assert steps[0]["error"] == "版本冲突"


async def test_fingerprint_conflict_rolls_back_the_whole_batch(
    db_stack: DbStack,
) -> None:
    session_id = await _pending(db_stack)
    url = f"{SESSIONS_URL}/{session_id}:receipts"
    first = {"call_id": "a", "output": "x" * 20000 + "A"}
    response = await db_stack.client.post(url, json={"tool_results": [first]})
    assert response.status_code == 200
    before = await _messages(db_stack, session_id)
    response = await db_stack.client.post(
        url,
        json={
            "tool_results": [
                {"call_id": "b", "output": "actual"},
                {"call_id": "a", "output": "x" * 20000 + "B"},
            ]
        },
    )
    assert response.status_code == 400
    assert await _messages(db_stack, session_id) == before


async def test_foreign_session_and_missing_permission_cannot_report_results(
    db_stack: DbStack,
    sign: Any,
) -> None:
    session_id = await _pending(db_stack)
    url = f"{SESSIONS_URL}/{session_id}:receipts"
    payload = {"tool_results": [{"call_id": "a", "output": "ok"}]}
    response = await db_stack.client.post(
        url, json=payload, headers=sign([ASSISTANT_USE])
    )
    assert response.status_code == 404
    response = await db_stack.client.post(url, json=payload, headers=sign([]))
    assert response.status_code == 403


async def test_legacy_advance_saves_actual_receipt_before_model_failure(
    db_stack: DbStack,
) -> None:
    session_id = await _pending(db_stack)
    install(db_stack, ScriptedChat(error=ValueError("测试模型故障")))
    events = await advance(
        db_stack.client,
        session_id,
        tool_results=[{"call_id": "b", "error": "无法保存"}],
    )
    assert events[-1][0] == "error"
    messages = await _messages(db_stack, session_id)
    steps = [
        step
        for message in messages
        for step in message["steps"]
        if step["kind"] == "client_tool"
    ]
    assert steps[1]["state"] == "failed"
    assert steps[1]["error"] == "无法保存"


async def test_saved_receipts_do_not_duplicate_model_context_or_messages(
    db_stack: DbStack,
) -> None:
    session_id = await _pending(db_stack)
    result = {"call_id": "a", "output": {"is_saved": False}}
    response = await db_stack.client.post(
        f"{SESSIONS_URL}/{session_id}:receipts", json={"tool_results": [result]}
    )
    assert response.status_code == 200
    model = ScriptedChat(reply=AIMessage(content="修改仅在草稿中"))
    install(db_stack, model)
    events = await advance(db_stack.client, session_id, tool_results=[result])
    assert events[-1][0] == "turn.done"
    actual = [
        one
        for one in model.seen[0]
        if isinstance(one, ToolMessage) and one.tool_call_id == "a"
    ]
    assert len(actual) == 1
    messages = await _messages(db_stack, session_id)
    assert (
        len(
            [
                message
                for message in messages
                if message["role"] == "tool"
                and message["content_json"].get("tool_call_id") == "a"
            ]
        )
        == 1
    )


async def _store_legacy_batch(db_stack: DbStack, session_id: str) -> None:
    """把测试会话构造成实际旧版存储形状，仍在回滚事务中。"""
    async with db_stack.sessions() as session:
        messages = await session_crud.messages_of(
            session, uuid.UUID(session_id)
        )
        grouped = await session_crud.steps_of(
            session, [message.id for message in messages]
        )
        steps = [
            step
            for values in grouped.values()
            for step in values
            if step.kind == "client_tool"
        ]
        steps.sort(key=lambda step: step.seq)
        steps[0].input_json = {
            "calls": [
                {
                    "call_id": "a",
                    "name": steps[0].name,
                    "arguments": {"node_id": "n1"},
                },
                {
                    "call_id": "b",
                    "name": steps[1].name,
                    "arguments": {"node_id": "n2"},
                },
            ]
        }
        await session.delete(steps[1])
        await session.commit()


async def test_legacy_stored_batch_settles_second_call_with_unique_step_order(
    db_stack: DbStack,
) -> None:
    session_id = await _pending(db_stack)
    await _store_legacy_batch(db_stack, session_id)
    response = await db_stack.client.post(
        f"{SESSIONS_URL}/{session_id}:receipts",
        json={"tool_results": [{"call_id": "b", "output": "modified draft"}]},
    )
    assert response.status_code == 200
    messages_out = await _messages(db_stack, session_id)
    steps_out = [
        step
        for message in messages_out
        for step in message["steps"]
        if step["kind"] == "client_tool"
    ]
    assert [step["state"] for step in steps_out] == [
        "awaiting_client",
        "succeeded",
    ]
    assert steps_out[1]["input_json"] == {
        "call_id": "b",
        "arguments": {"node_id": "n2"},
    }
    assert steps_out[0]["seq"] != steps_out[1]["seq"]


async def test_two_salvaged_client_batches_keep_their_actual_receipts(
    db_stack: DbStack,
) -> None:
    written = AIMessage(
        content=(
            "<tool_call><function=dashboard.write_binding>"
            "<parameter=node_id>test-node</parameter></function></tool_call>"
        )
    )
    model = ScriptedChat(
        script=[written, written, AIMessage(content="仅修改草稿")]
    )
    install(db_stack, model)
    session_id = await new_session(db_stack.client)
    events = await advance(
        db_stack.client, session_id, user_text="配置测试草稿"
    )
    ids: list[str] = []
    for at in range(2):
        assert events[-1][0] == "client_tool.request"
        call_id = str(events[-1][1]["calls"][0]["call_id"])
        ids.append(call_id)
        result = {
            "call_id": call_id,
            "output": {"is_saved": False, "operation": at + 1},
        }
        response = await db_stack.client.post(
            f"{SESSIONS_URL}/{session_id}:receipts",
            json={"tool_results": [result]},
        )
        assert response.status_code == 200
        events = await advance(
            db_stack.client, session_id, tool_results=[result]
        )
    assert len(set(ids)) == 2
    assert events[-1][0] == "turn.done"
    assert model.calls == 3
    messages = await _messages(db_stack, session_id)
    _assert_salvaged_receipts(messages, ids)


def _assert_salvaged_receipts(
    messages: list[dict[str, Any]], ids: list[str]
) -> None:
    steps = [
        step
        for message in messages
        for step in message["steps"]
        if step["kind"] == "client_tool"
    ]
    assert [step["state"] for step in steps] == ["succeeded", "succeeded"]
    tools = [message for message in messages if message["role"] == "tool"]
    assert [message["content_json"]["tool_call_id"] for message in tools] == ids
    assert len(tools) == 2
    assert [message["content_json"]["text"] for message in tools] == [
        '{"is_saved": false, "operation": 1}',
        '{"is_saved": false, "operation": 2}',
    ]
