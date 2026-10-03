"""确认票据绑定完整调用和部署依据，拒绝过期、改参和非 JSON 目标。"""

import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from ai_assistant.apps.chat.services.client_receipts import StoredCall
from ai_assistant.apps.chat.services.mcp_write_grants import (
    PendingWrite,
    binding,
    canonical,
    check_ticket,
    digest,
    target_of,
)
from ai_assistant.apps.chat.services.tools.mcp_policy import McpWritePolicy
from ai_assistant.upstream.mcp import McpToolInfo
from lib.errors import Conflict, ValidationFailed

NOW = datetime(2035, 1, 1, tzinfo=UTC)
TOKEN = "synthetic-confirmation-ticket-at-least-32"
TARGET = "20000000-0000-0000-0000-000000000001"
POLICY = McpWritePolicy(
    frozenset({"dashboard:view", "dashboard:edit"}), "target", "保存看板"
)
TOOL = McpToolInfo("audit", "save", "external text", {"type": "object"})


@pytest.fixture
def pending() -> PendingWrite:
    return PendingWrite(
        uuid.UUID("10000000-0000-0000-0000-000000000001"),
        uuid.UUID("10000000-0000-0000-0000-000000000002"),
        uuid.UUID("10000000-0000-0000-0000-000000000003"),
        StoredCall(
            call_id="write", name="mcp.audit.save", arguments={"target": TARGET}
        ),
    )


@pytest.mark.parametrize("field", ["session_id", "owner_id", "step_id"])
def test_ticket_cannot_move_to_another_identity(
    pending: PendingWrite, field: str
) -> None:
    changed = replace(
        pending, **{field: uuid.UUID("30000000-0000-0000-0000-000000000001")}
    )
    assert binding(pending, POLICY, TOOL) != binding(changed, POLICY, TOOL)


@pytest.mark.parametrize(
    "patch",
    [
        {"name": "mcp.audit.delete"},
        {"call_id": "other"},
        {"arguments": {"target": TARGET, "label": "changed"}},
    ],
)
def test_changed_call_requires_new_consent(
    pending: PendingWrite, patch: dict[str, object]
) -> None:
    updated = replace(pending, call=pending.call.model_copy(update=patch))
    assert binding(pending, POLICY, TOOL) != binding(updated, POLICY, TOOL)


@pytest.mark.parametrize(
    "tool",
    [
        replace(
            TOOL, input_schema={"type": "object", "additionalProperties": False}
        ),
        replace(TOOL, has_read_only_hint=True),
    ],
)
def test_changed_catalog_requires_new_consent(
    pending: PendingWrite, tool: McpToolInfo
) -> None:
    assert binding(pending, POLICY, TOOL) != binding(pending, POLICY, tool)


def test_changed_policy_requires_new_consent(pending: PendingWrite) -> None:
    policy = replace(POLICY, impact="删除看板")
    assert binding(pending, POLICY, TOOL) != binding(pending, policy, TOOL)


@pytest.mark.parametrize("state", ["claimed", "consumed", "missing"])
def test_consumed_ticket_never_validates_again(state: str) -> None:
    grant = {
        "sha256": digest(TOKEN),
        "binding": "bound",
        "state": state,
        "expires_at": (NOW + timedelta(seconds=120)).isoformat(),
    }
    with pytest.raises(Conflict):
        check_ticket(grant, TOKEN, "bound", NOW)


@pytest.mark.parametrize(
    "expiry", ["malformed", "2035-01-01T00:00:00+00:00", "2036-01-01T00:00:00"]
)
def test_expiry_is_strict_and_requires_timezone(expiry: str) -> None:
    grant = {
        "sha256": digest(TOKEN),
        "binding": "bound",
        "state": "issued",
        "expires_at": expiry,
    }
    with pytest.raises(Conflict):
        check_ticket(grant, TOKEN, "bound", NOW)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), object()])
def test_non_json_arguments_are_rejected(value: object) -> None:
    with pytest.raises(ValidationFailed):
        canonical(value)


@pytest.mark.parametrize("target", [None, 42, {"id": TARGET}, "not-a-uuid"])
def test_write_requires_verifiable_top_level_uuid(
    pending: PendingWrite, target: object
) -> None:
    changed = replace(
        pending,
        call=pending.call.model_copy(update={"arguments": {"target": target}}),
    )
    with pytest.raises(ValidationFailed):
        target_of(changed, POLICY)


def test_ticket_expired_missing_or_wrong_binding_rejects() -> None:
    with pytest.raises(Conflict):
        check_ticket({}, TOKEN, "bound", NOW)
    grant = {
        "sha256": digest(TOKEN),
        "binding": "bound",
        "state": "issued",
        "expires_at": (NOW + timedelta(seconds=120)).isoformat(),
    }
    check_ticket(grant, TOKEN, "bound", NOW)
    with pytest.raises(Conflict):
        check_ticket(grant, TOKEN, "changed", NOW)
