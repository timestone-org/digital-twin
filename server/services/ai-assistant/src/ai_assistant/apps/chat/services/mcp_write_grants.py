"""将短期确认绑定到属主、调用、入参、当前本地政策与工具目录。"""

import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from ai_assistant.apps.chat.models import ChatStep
from ai_assistant.apps.chat.services.client_receipts import StoredCall
from ai_assistant.apps.chat.services.tools.mcp_policy import McpWritePolicy
from ai_assistant.upstream.mcp import McpToolInfo
from lib.errors import Conflict, ValidationFailed


@dataclass(frozen=True)
class PendingWrite:
    """事务外验证所需的不可变调用快照。"""

    session_id: uuid.UUID
    owner_id: uuid.UUID
    step_id: uuid.UUID
    call: StoredCall


def snapshot(
    step: ChatStep, session_id: uuid.UUID, owner_id: uuid.UUID
) -> PendingWrite:
    """只从已存步骤读取名称与入参。

    Args: step, session_id, owner_id。"""
    source = step.input_json or {}
    call = StoredCall.model_validate(
        {
            "call_id": source.get("call_id"),
            "name": step.name,
            "arguments": source.get("arguments"),
        }
    )
    canonical(call.arguments)
    return PendingWrite(session_id, owner_id, step.id, call)


def canonical(value: object) -> str:
    """稳定 JSON，拒绝非 JSON 和 NaN。

    Args: value。"""
    try:
        return json.dumps(
            value,
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as error:
        raise ValidationFailed("调用参数不是有效 JSON") from error


def binding(
    pending: PendingWrite, policy: McpWritePolicy, tool: McpToolInfo
) -> str:
    """政策或工具 schema/分类改变时，已有同意作废。

    Args: pending, policy, tool。"""
    body = {
        "owner": str(pending.owner_id),
        "session": str(pending.session_id),
        "step": str(pending.step_id),
        "call": pending.call.model_dump(),
        "policy": {
            "codes": sorted(policy.required_codes),
            "target": policy.target_parameter,
            "impact": policy.impact,
            "resource_kind": policy.resource_kind,
        },
        "tool": {
            "server": tool.server,
            "name": tool.tool,
            "schema": tool.input_schema,
            "read_only": tool.is_read_only,
        },
    }
    return hashlib.sha256(canonical(body).encode()).hexdigest()


def digest(ticket: str) -> str:
    """原始票据不落库。

    Args: ticket。"""
    return hashlib.sha256(ticket.encode()).hexdigest()


def check_ticket(
    grant: dict[str, Any], ticket: str, expected: str, now: datetime
) -> None:
    """已领取、过期、改参或不同票据均拒绝。

    Args: grant, ticket, expected, now。"""
    stored, bound, expiry = (
        grant.get(key) for key in ("sha256", "binding", "expires_at")
    )
    if not isinstance(stored, str) or not isinstance(expiry, str):
        raise Conflict("确认票据不存在或已失效")
    try:
        expires = datetime.fromisoformat(expiry)
        valid_time = expires.tzinfo is not None and now < expires
    except ValueError:
        valid_time = False
    if (
        grant.get("state") != "issued"
        or not valid_time
        or bound != expected
        or not hmac.compare_digest(stored, digest(ticket))
    ):
        raise Conflict("确认票据已失效，请重新查看操作")


def target_of(pending: PendingWrite, policy: McpWritePolicy) -> uuid.UUID:
    """政策指定的顶级参数必须是实际资源 UUID。

    Args: pending, policy。"""
    target = pending.call.arguments.get(policy.target_parameter)
    if not isinstance(target, str):
        raise ValidationFailed("写操作缺少可验证的目标资源")
    try:
        return uuid.UUID(target)
    except ValueError as error:
        raise ValidationFailed("写操作目标必须是资源 UUID") from error
