"""HVAC 投递的 PostgreSQL 租约与消费栅栏。"""

import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import DateTime, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from lib.utils.ids import uuid7
from platform_server.apps.hvac.models import AcDispatch


@dataclass(frozen=True)
class PendingDispatch:
    """在短事务中认领的投递内容。"""

    id: uuid.UUID
    token: uuid.UUID
    kind: str
    fields: dict[str, str]


async def database_now(session: AsyncSession) -> datetime:
    """读 PostgreSQL 的墙钟。Args: session。"""
    result = await session.scalar(
        func.clock_timestamp(type_=DateTime(timezone=True))
    )
    if result is None:
        raise RuntimeError("数据库未返回当前时刻")
    return result


async def claim_dispatch(
    session: AsyncSession,
    kinds: Collection[str],
    requested: tuple[uuid.UUID, ...] | None,
    lease_s: float,
) -> PendingDispatch | None:
    """认领一条到期且尚未投递的消息。

    Args: session, kinds, requested, lease_s。
    """
    now = await database_now(session)
    pending = select(AcDispatch).where(
        AcDispatch.kind.in_(kinds),
        AcDispatch.dispatch_after <= now,
        AcDispatch.published_at.is_(None),
        AcDispatch.entry_id.is_(None),
    )
    if requested is not None:
        pending = pending.where(AcDispatch.id.in_(requested))
    row = await session.scalar(
        pending.order_by(AcDispatch.dispatch_after, AcDispatch.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if row is None:
        return None
    token = uuid7()
    row.dispatch_token = token
    row.dispatch_after = now + timedelta(seconds=lease_s)
    return PendingDispatch(row.id, token, row.kind, dict(row.fields))


async def is_current(session: AsyncSession, attempt: PendingDispatch) -> bool:
    """确认投递租约仍然有效。Args: session, attempt。"""
    result = await session.scalar(
        select(AcDispatch.id).where(
            AcDispatch.id == attempt.id,
            AcDispatch.dispatch_token == attempt.token,
            AcDispatch.dispatch_after > func.clock_timestamp(),
            AcDispatch.published_at.is_(None),
            AcDispatch.entry_id.is_(None),
        )
    )
    return result is not None


async def mark_published(
    session: AsyncSession, attempt: PendingDispatch
) -> None:
    """只由本次持有者登记发布完成。Args: session, attempt。"""
    await session.execute(
        update(AcDispatch)
        .where(
            AcDispatch.id == attempt.id,
            AcDispatch.dispatch_token == attempt.token,
            AcDispatch.dispatch_after > func.clock_timestamp(),
        )
        .values(published_at=func.clock_timestamp(), dispatch_token=None)
    )


async def lock_dispatch(
    session: AsyncSession, dispatch_id: uuid.UUID
) -> AcDispatch | None:
    """读取用于消费认领的最新信封。Args: session, dispatch_id。"""
    return await session.get(
        AcDispatch,
        dispatch_id,
        with_for_update=True,
        populate_existing=True,
    )


async def complete(
    session: AsyncSession, dispatch_id: uuid.UUID, token: uuid.UUID
) -> bool:
    """仅当前消费者登记成功后才有权确认消息。

    Args: session, dispatch_id, token。
    """
    completed_id = await session.scalar(
        update(AcDispatch)
        .where(
            AcDispatch.id == dispatch_id,
            AcDispatch.execution_token == token,
            AcDispatch.execution_until > func.clock_timestamp(),
            AcDispatch.completed_at.is_(None),
        )
        .values(
            completed_at=func.clock_timestamp(),
            execution_token=None,
            execution_until=None,
        )
        .returning(AcDispatch.id)
    )
    return completed_id is not None


async def prune_completed(session: AsyncSession) -> None:
    """按批删除一天前已处理完的信封。Args: session。"""
    cutoff = await database_now(session) - timedelta(days=1)
    expired = (
        select(AcDispatch.id)
        .where(AcDispatch.completed_at < cutoff)
        .order_by(AcDispatch.completed_at, AcDispatch.id)
        .limit(200)
        .with_for_update(skip_locked=True)
    )
    await session.execute(delete(AcDispatch).where(AcDispatch.id.in_(expired)))
