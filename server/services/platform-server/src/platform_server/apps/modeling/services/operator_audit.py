"""可信网关的外部操作者声明与平台账号审计。"""

import uuid
from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.errors import PermissionDenied, ValidationFailed
from lib.logging.context import current_log_context
from platform_server.apps.modeling.models.operator_audit import (
    ModelingOperatorAudit,
)

MAX_OPERATOR_IDENTIFIER_LENGTH = 128


@dataclass(frozen=True)
class OperatorIdentity:
    account_user_id: uuid.UUID
    external_operator_id: str | None
    source_ip: str | None


@dataclass(frozen=True)
class AuditEvent:
    operation: str
    resource_id: uuid.UUID | None
    command_id: uuid.UUID | None
    http_status: int


def resolve_operator(
    caller: CallerContext,
    external_operator_id: str | None,
    trusted_accounts: Collection[uuid.UUID],
    source_ip: str | None,
) -> OperatorIdentity:
    """只接受专用网关账号的操作者声明。

    Args: caller, external_operator_id, trusted_accounts, source_ip。
    """
    if external_operator_id is not None:
        if caller.user_id not in trusted_accounts:
            raise PermissionDenied("当前账号无权声明外部操作者")
        if (
            not external_operator_id
            or len(external_operator_id) > MAX_OPERATOR_IDENTIFIER_LENGTH
            or not external_operator_id.isascii()
            or not external_operator_id.isprintable()
            or any(character.isspace() for character in external_operator_id)
        ):
            raise ValidationFailed(
                "外部操作者标识须为 1–128 个无空白 ASCII 字符"
            )
    return OperatorIdentity(caller.user_id, external_operator_id, source_ip)


def record_operator(
    session: AsyncSession, identity: OperatorIdentity, event: AuditEvent
) -> None:
    """与当前业务事务一起保存审计；Args: session, identity, event。"""
    session.add(
        ModelingOperatorAudit(
            account_user_id=identity.account_user_id,
            external_operator_id=identity.external_operator_id,
            source_ip=identity.source_ip,
            operation=event.operation,
            resource_id=event.resource_id,
            command_id=event.command_id,
            http_status=event.http_status,
            trace_id=current_log_context().trace_id or "",
        )
    )
