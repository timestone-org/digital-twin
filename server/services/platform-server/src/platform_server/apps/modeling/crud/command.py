"""建模命令的原子预留、账号范围读取与事务内回执。"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from pydantic import JsonValue
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.models.command import ModelingCommand


@dataclass(frozen=True)
class CommandIdentity:
    account_user_id: uuid.UUID
    scope: str
    key_hash: str


async def reserve(
    session: AsyncSession, candidate: ModelingCommand
) -> tuple[ModelingCommand, bool]:
    """用唯一约束认领命令；Args: session, candidate。"""
    result = await session.execute(
        insert(ModelingCommand)
        .values(
            id=candidate.id,
            account_user_id=candidate.account_user_id,
            scope=candidate.scope,
            key_hash=candidate.key_hash,
            request_hash=candidate.request_hash,
            state="pending",
            trace_id=candidate.trace_id,
        )
        .on_conflict_do_nothing(
            index_elements=["account_user_id", "scope", "key_hash"]
        )
        .returning(ModelingCommand)
    )
    inserted = result.scalar_one_or_none()
    if inserted is not None:
        return inserted, True
    identity = CommandIdentity(
        candidate.account_user_id, candidate.scope, candidate.key_hash
    )
    existing = await find(session, identity)
    if existing is None:
        raise RuntimeError("命令唯一约束未返回对应记录")
    return existing, False


async def find(
    session: AsyncSession, identity: CommandIdentity
) -> ModelingCommand | None:
    return await session.scalar(
        select(ModelingCommand).where(
            ModelingCommand.account_user_id == identity.account_user_id,
            ModelingCommand.scope == identity.scope,
            ModelingCommand.key_hash == identity.key_hash,
        )
    )


async def get(
    session: AsyncSession, account_user_id: uuid.UUID, command_id: uuid.UUID
) -> ModelingCommand | None:
    return await session.scalar(
        select(ModelingCommand).where(
            ModelingCommand.id == command_id,
            ModelingCommand.account_user_id == account_user_id,
        )
    )


@dataclass(frozen=True)
class CommandCompletion:
    command_id: uuid.UUID
    http_status: int
    result: dict[str, JsonValue]
    completed_at: datetime
    is_failure: bool = False


async def complete(session: AsyncSession, result: CommandCompletion) -> None:
    """与业务写入同事务完成命令；Args: session, result。"""
    await session.execute(
        update(ModelingCommand)
        .where(
            ModelingCommand.id == result.command_id,
            ModelingCommand.state == "pending",
        )
        .values(
            state="failed" if result.is_failure else "succeeded",
            http_status=result.http_status,
            result_json=None if result.is_failure else result.result,
            error_json=result.result if result.is_failure else None,
            completed_at=result.completed_at,
        )
    )
