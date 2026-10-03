"""真实 Postgres 确认协议：单次领取、撤权、取消与实际回执。"""

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import timedelta

import pytest
from sqlalchemy import delete

from ai_assistant.apps.chat.api.mcp_writes import get_mcp_write_service
from ai_assistant.apps.chat.models import ChatSession
from ai_assistant.apps.chat.schemas.mcp_writes import McpWriteDecisionIn
from ai_assistant.apps.chat.services import mcp_writes
from ai_assistant.apps.chat.services.mcp_writes import (
    McpWriteService,
)
from ai_assistant.settings import Settings
from integration.mcp_write_support import (
    BASE,
    FIXED_NOW,
    FULL,
    OTHER,
    OWNER,
    TARGET,
    TOOL_NAME,
    Stack,
    add_unrelated_blocked_server,
    change_pending,
    headers,
    install_deadline,
    install_mcp_model,
    open_stack,
    seed,
)
from lib.auth import (
    CallerContext,
)

pytestmark = pytest.mark.requires_postgres


async def test_prepare_execute_actual_receipt_and_replay(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    step = await stack.step()
    assert ticket not in json.dumps(step.input_json)
    assert len(step.input_json["_mcp_write_grant"]["sha256"]) == 64
    spoof = await stack.client.post(
        f"{BASE}/{stack.session_id}:receipts",
        json={
            "tool_results": [{"call_id": "write", "output": {"saved": True}}]
        },
    )
    assert spoof.status_code == 400
    response = await stack.decide(ticket)
    assert response.status_code == 200
    assert response.json()["data"] == {
        "call_id": "write",
        "output": {"saved": True},
        "error": None,
    }
    assert len(stack.external.dispatches) == 1
    assert stack.external.auth_calls == 4
    step = await stack.step()
    assert step.state == "succeeded"
    assert len(step.output_json["receipt_sha256"]) == 64
    assert (await stack.decide(ticket)).status_code == 409
    assert len(stack.external.dispatches) == 1
    accepted = await stack.client.post(
        f"{BASE}/{stack.session_id}:receipts",
        json={"tool_results": [response.json()["data"]]},
    )
    assert accepted.status_code == 200
    detail = await stack.client.get(f"{BASE}/{stack.session_id}")
    tools = [
        m for m in detail.json()["data"]["messages"] if m["role"] == "tool"
    ]
    assert len(tools) == 1
    assert tools[0]["content_json"]["text"] == '{"saved": true}'


async def test_cancel_after_revocation_has_no_external_io(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    stack.external.codes = frozenset()
    result = await stack.decide(ticket, False)
    assert result.status_code == 200
    assert result.json()["data"]["output"] == {"is_cancelled": True}
    assert (await stack.step()).state == "aborted"
    assert stack.external.auth_calls == 2
    assert stack.external.dispatches == []
    assert (await stack.decide(ticket, False)).status_code == 409


@pytest.mark.parametrize(
    ("mode", "status"),
    [
        ("bad_signature", 401),
        ("wrong_owner", 401),
        ("expired", 401),
        ("unavailable", 503),
        ("revoked", 403),
    ],
)
async def test_current_identity_is_required_before_dispatch(
    db_mcp_stack: Stack, mode: str, status: int
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    if mode == "revoked":
        stack.external.codes = frozenset({"assistant:use", "dashboard:view"})
    else:
        stack.external.auth_mode = mode
    response = await stack.decide(ticket)
    assert response.status_code == status, response.text
    assert stack.external.dispatches == []
    assert (await stack.step()).state == "failed"
    stack.external.codes, stack.external.auth_mode = FULL, "normal"
    assert (await stack.decide(ticket)).status_code == 409
    assert stack.external.dispatches == []


@pytest.mark.parametrize(
    "change",
    [
        "ticket",
        "expired",
        "arguments",
        "schema",
        "missing_tool",
        "new_turn",
        "legacy",
    ],
)
async def test_changed_or_stale_confirmation_is_not_dispatched(
    db_mcp_stack: Stack, change: str
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    if change == "ticket":
        ticket = "forged" * 8
    elif change == "expired":
        stack.external.now += timedelta(seconds=120)
    elif change == "schema":
        stack.external.schema_version = 2
    elif change == "missing_tool":
        stack.external.has_tool = False
    else:
        await change_pending(stack, change)
    response = await stack.decide(ticket)
    assert response.status_code in {403, 409}, response.text
    assert stack.external.dispatches == []


@pytest.mark.parametrize("status", [403, 404])
async def test_target_revalidation_failure_does_not_dispatch(
    db_mcp_stack: Stack, status: int
) -> None:
    ticket = await db_mcp_stack.prepare()
    db_mcp_stack.external.target_status = status
    assert (await db_mcp_stack.decide(ticket)).status_code == 503
    assert db_mcp_stack.external.dispatches == []


@pytest.mark.parametrize("mode", ["timeout", "tool_error"])
async def test_actual_failure_is_recorded_and_never_retried(
    db_mcp_stack: Stack, mode: str
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    stack.external.execution_mode = mode
    response = await stack.decide(ticket)
    assert response.status_code == 200
    assert response.json()["data"]["error"] is not None
    assert (await stack.step()).state == "failed"
    assert len(stack.external.dispatches) == 1
    assert (await stack.decide(ticket)).status_code == 409
    assert len(stack.external.dispatches) == 1


async def test_concurrent_decisions_claim_once_in_independent_transactions(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    stack.external.execution_mode = "blocked"
    first = asyncio.create_task(stack.decide(ticket))
    await asyncio.wait_for(stack.external.entered.wait(), timeout=5)
    second = await stack.decide(ticket)
    assert second.status_code == 409
    async with stack.database.session() as session:
        await mcp_writes.invalidate_pending(session, stack.session_id)
    assert (await stack.step()).state == "running"
    stack.external.release.set()
    assert (await first).status_code == 200
    assert len(stack.external.dispatches) == 1
    assert (await stack.step()).state == "succeeded"


async def test_caller_cancellation_preserves_actual_execution_receipt(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    stack.external.execution_mode = "blocked"
    caller = CallerContext(OWNER, "审核", "admin", FULL)
    task = asyncio.create_task(
        stack.service.decide(
            stack.session_id,
            "write",
            caller,
            McpWriteDecisionIn(ticket=ticket, confirm=True),
        )
    )
    await asyncio.wait_for(stack.external.entered.wait(), timeout=5)
    task.cancel()
    stack.external.release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(stack.external.dispatches) == 1
    assert (await stack.step()).state == "succeeded"
    assert (await stack.step()).output_json["body"] == '{"saved": true}'


async def test_owner_and_prepare_body_are_enforced(db_mcp_stack: Stack) -> None:
    stack = db_mcp_stack
    for body in [
        {"tool_name": TOOL_NAME},
        {"arguments": {"target_id": TARGET}},
    ]:
        assert (
            await stack.client.post(f"{stack.url}:prepare", json=body)
        ).status_code == 400
    stack.client.headers.update(headers(OTHER, FULL, FIXED_NOW))
    assert (await stack.client.post(f"{stack.url}:prepare")).status_code == 404
    assert stack.external.auth_calls == 0
    assert stack.external.dispatches == []


async def test_revocation_during_target_lookup_prevents_dispatch(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    stack.external.is_target_blocked = True
    task = asyncio.create_task(stack.decide(ticket))
    await asyncio.wait_for(stack.external.target_entered.wait(), timeout=5)
    stack.external.codes = frozenset({"assistant:use", "dashboard:view"})
    stack.external.target_release.set()
    assert (await task).status_code == 403
    assert stack.external.dispatches == []
    assert (await stack.step()).state == "failed"
    stack.external.codes = FULL
    assert (await stack.decide(ticket)).status_code == 409


async def test_current_deployment_policy_can_revoke_a_stored_ticket(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    settings = stack.deps.settings.model_copy(
        update={"mcp_write_allowed": "[]"}
    )
    service = McpWriteService(
        replace(stack.deps, settings=settings), clock=lambda: stack.external.now
    )
    stack.app.dependency_overrides[get_mcp_write_service] = lambda: service
    assert (await stack.decide(ticket)).status_code == 403
    assert stack.external.dispatches == []
    assert (await stack.step()).state == "failed"


async def test_real_advance_persists_confirmable_mcp_call(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    await install_mcp_model(stack)
    response = await stack.client.post(
        f"{BASE}/{stack.session_id}:advance",
        json={
            "surface_kind": "dashboard-editor",
            "user_text": "调用 MCP 保存测试看板",
            "client_tools": ["mcp.confirm_write"],
        },
    )
    assert response.status_code == 200
    assert "event: client_tool.request" in response.text, response.text
    assert stack.external.dispatches == []
    detail = await stack.client.get(f"{BASE}/{stack.session_id}")
    steps = [
        step
        for message in detail.json()["data"]["messages"]
        for step in message["steps"]
        if step["kind"] == "client_tool"
    ]
    assert len(steps) == 1
    assert steps[0]["input_json"]["_mcp_confirmation_protocol"] == 1
    ticket = await stack.prepare()
    assert (await stack.decide(ticket)).status_code == 200
    assert len(stack.external.dispatches) == 1


async def test_foreign_session_and_call_ticket_cannot_dispatch(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    other_session, _step_id = await seed(stack.database)
    try:
        response = await stack.client.post(
            f"{BASE}/{other_session}/mcp-writes/write:decide",
            json={"ticket": ticket, "confirm": True},
        )
        assert response.status_code == 409
        response = await stack.client.post(
            f"{BASE}/{stack.session_id}/mcp-writes/other:decide",
            json={"ticket": ticket, "confirm": True},
        )
        assert response.status_code == 409
        stack.client.headers.update(headers(OTHER, FULL, FIXED_NOW))
        assert (await stack.decide(ticket)).status_code == 404
        assert stack.external.dispatches == []
    finally:
        async with stack.database.session() as session:
            await session.execute(
                delete(ChatSession).where(ChatSession.id == other_session)
            )


async def test_prepare_rejects_legacy_and_unknown_policy(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    settings = stack.deps.settings.model_copy(
        update={"mcp_write_policies": "{}"}
    )
    service = McpWriteService(
        replace(stack.deps, settings=settings), clock=lambda: stack.external.now
    )
    stack.app.dependency_overrides[get_mcp_write_service] = lambda: service
    assert (await stack.client.post(f"{stack.url}:prepare")).status_code == 403
    assert stack.external.auth_calls == 0
    stack.app.dependency_overrides[get_mcp_write_service] = (
        lambda: stack.service
    )
    await change_pending(stack, "legacy")
    assert (await stack.client.post(f"{stack.url}:prepare")).status_code == 409
    assert stack.external.auth_calls == 0
    assert stack.external.dispatches == []


@pytest.fixture
async def db_mcp_stack(db_settings: Settings) -> AsyncIterator[Stack]:
    """每个用例独立连接、事务与会话，结束时清理本用例。Args: db_settings。"""
    async with open_stack(db_settings) as stack:
        yield stack


async def test_delete_running_mcp_preserves_actual_receipt(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    stack.external.execution_mode = "blocked"
    executing = asyncio.create_task(stack.decide(ticket))
    await asyncio.wait_for(stack.external.entered.wait(), timeout=5)
    deleted = await stack.client.delete(f"{BASE}/{stack.session_id}")
    stack.external.release.set()
    result = await executing
    assert deleted.status_code == 409, deleted.text
    assert "执行" in deleted.json()["message"]
    assert result.status_code == 200
    assert (await stack.step()).state == "succeeded"
    assert (await stack.step()).output_json["body"] == '{"saved": true}'
    assert len(stack.external.dispatches) == 1
    assert (
        await stack.client.delete(f"{BASE}/{stack.session_id}")
    ).status_code == 204


async def test_confirmation_refreshes_only_its_tool_server(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    await add_unrelated_blocked_server(stack)
    ticket = await asyncio.wait_for(stack.prepare(), timeout=1)
    assert (
        await asyncio.wait_for(stack.decide(ticket), timeout=1)
    ).status_code == 200
    assert len(stack.external.dispatches) == 1


async def test_execution_deadline_saves_unknown_receipt_without_retry(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    install_deadline(stack)
    stack.external.execution_mode = "blocked"
    response = await asyncio.wait_for(stack.decide(ticket), timeout=2)
    assert response.status_code == 200
    assert response.json()["data"]["error"] is not None
    assert "未知" in response.json()["data"]["error"]
    assert len(stack.external.dispatches) == 1
    assert (await stack.step()).state == "failed"
    assert len((await stack.step()).output_json["receipt_sha256"]) == 64
    assert (await stack.decide(ticket)).status_code == 409
    assert len(stack.external.dispatches) == 1


async def test_verification_deadline_consumes_ticket_without_dispatch(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    ticket = await stack.prepare()
    install_deadline(stack)
    stack.external.is_target_blocked = True
    response = await asyncio.wait_for(stack.decide(ticket), timeout=2)
    assert response.status_code == 504
    assert stack.external.dispatches == []
    assert (await stack.step()).state == "failed"
    stack.external.is_target_blocked = False
    assert (await stack.decide(ticket)).status_code == 409


async def test_expired_deadline_never_dispatches_synchronous_transport(
    db_mcp_stack: Stack,
) -> None:
    stack = db_mcp_stack
    caller = CallerContext(OWNER, "审核", "admin", FULL)
    pending = await stack.service._capture(stack.session_id, "write", caller)
    verified = await stack.service._verify(pending)
    deadline_at_s = asyncio.get_running_loop().time() - 1
    result = await stack.service._execute(pending, verified, deadline_at_s)
    assert stack.external.dispatches == []
    assert result.output == {
        "is_dispatched": False,
        "reason": "deadline_expired",
    }
    assert result.error is not None
    assert "未派发" in result.error
