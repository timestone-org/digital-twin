"""持久建模命令的账号范围读取与无接管的状态展示。"""

import uuid
from datetime import datetime, timedelta

from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.errors import PermissionDenied
from platform_server.apps.modeling.command_errors import CommandNotFound
from platform_server.apps.modeling.crud import command
from platform_server.apps.modeling.models.command import ModelingCommand
from platform_server.apps.modeling.schemas.command import (
    CommandFailureOut,
    CommandState,
    ModelingCommandOut,
)
from platform_server.apps.modeling.services.command_policy import (
    Operation,
    hash_key,
    parse_scope,
)

UNKNOWN_AFTER = timedelta(minutes=5)
_STATES: TypeAdapter[CommandState] = TypeAdapter(CommandState)


def authorize(caller: CallerContext, operation: Operation) -> None:
    if operation.permission not in caller.permissions:
        raise PermissionDenied("没有查询此类建模命令的权限")


async def find_command(
    session: AsyncSession,
    caller: CallerContext,
    operation: Operation,
    key: str,
    now: datetime,
) -> ModelingCommandOut:
    """按账号、操作与键查回执；Args: session, caller, operation, key, now。"""
    authorize(caller, operation)
    row = await command.find(
        session,
        command.CommandIdentity(caller.user_id, operation.scope, hash_key(key)),
    )
    if row is None:
        raise CommandNotFound("没有这条建模命令的记录")
    return present(row, now)


async def get_command(
    session: AsyncSession,
    caller: CallerContext,
    command_id: uuid.UUID,
    now: datetime,
) -> ModelingCommandOut:
    """按当前账号查询命令ID；Args: session, caller, command_id, now。"""
    row = await command.get(session, caller.user_id, command_id)
    if row is None:
        raise CommandNotFound("没有这条建模命令的记录")
    authorize(caller, parse_scope(row.scope))
    return present(row, now)


def present(row: ModelingCommand, now: datetime) -> ModelingCommandOut:
    operation = parse_scope(row.scope)
    is_pending = row.state == "pending"
    state = row.state
    if is_pending and now - row.created_at >= UNKNOWN_AFTER:
        state = "unknown"
    return ModelingCommandOut(
        id=row.id,
        operation=operation.name,
        resource_id=operation.resource_id,
        state=_STATES.validate_python(state),
        http_status=row.http_status,
        result=row.result_json,
        error=(
            CommandFailureOut.model_validate(row.error_json)
            if row.error_json is not None
            else None
        ),
        created_at=row.created_at,
        completed_at=row.completed_at,
        trace_id=row.trace_id,
        is_verification_required=is_pending,
    )
