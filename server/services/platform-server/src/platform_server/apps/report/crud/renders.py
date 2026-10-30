"""生成任务的原子认领和有界游标查询。"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, and_, cast, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from platform_server.apps.report.models import ReportRender

_CAPACITY_LOCK = "platform.report.pending_capacity"


async def get(
    session: AsyncSession, render_id: uuid.UUID
) -> ReportRender | None:
    return await session.get(ReportRender, render_id)


async def by_request(session: AsyncSession, key: str) -> ReportRender | None:
    return await session.scalar(
        select(ReportRender).where(ReportRender.request_key == key)
    )


async def add(session: AsyncSession, row: ReportRender) -> ReportRender:
    session.add(row)
    await session.flush()
    return row


async def page(
    session: AsyncSession,
    template_id: uuid.UUID | None,
    anchor: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[ReportRender]:
    query = select(ReportRender)
    if template_id is not None:
        query = query.where(ReportRender.template_id == template_id)
    if anchor is not None:
        stamp, render_id = anchor
        query = query.where(
            or_(
                ReportRender.created_at < stamp,
                and_(
                    ReportRender.created_at == stamp,
                    ReportRender.id < render_id,
                ),
            )
        )
    return list(
        await session.scalars(
            query.order_by(
                ReportRender.created_at.desc(), ReportRender.id.desc()
            ).limit(limit + 1)
        )
    )


async def claim(
    session: AsyncSession, render_id: uuid.UUID, now: datetime
) -> ReportRender | None:
    result = await session.execute(
        update(ReportRender)
        .where(ReportRender.id == render_id, ReportRender.status == "pending")
        .values(status="running", started_at=now)
        .returning(ReportRender.id)
    )
    return (
        await get(session, render_id) if result.scalar_one_or_none() else None
    )


async def finish(
    session: AsyncSession, render_id: uuid.UUID, changes: dict[str, object]
) -> bool:
    result = await session.execute(
        update(ReportRender)
        .where(ReportRender.id == render_id, ReportRender.status == "running")
        .values(**changes)
        .returning(ReportRender.id)
    )
    return result.scalar_one_or_none() is not None


async def fail_stale(
    session: AsyncSession, cutoff: datetime, now: datetime, limit: int
) -> int:
    expired = or_(
        ReportRender.started_at < cutoff,
        and_(
            ReportRender.started_at.is_(None), ReportRender.updated_at < cutoff
        ),
    )
    selected = (
        select(ReportRender.id)
        .where(ReportRender.status == "running", expired)
        .order_by(ReportRender.updated_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    result = await session.execute(
        update(ReportRender)
        .where(
            ReportRender.id.in_(selected),
            ReportRender.status == "running",
            expired,
        )
        .values(
            status="failed",
            result_json=None,
            error="生成任务中断或超过时限，请重新生成",
            finished_at=now,
        )
        .returning(ReportRender.id)
    )
    return len(result.scalars().all())


async def dispatch_clock(session: AsyncSession) -> datetime:
    moment = await session.scalar(select(func.clock_timestamp()))
    if not isinstance(moment, datetime):
        raise ValueError("数据库未能返回投递时钟")
    return moment


async def pending_dispatch(
    session: AsyncSession, limit: int
) -> list[ReportRender]:
    due = cast(
        ReportRender.result_json["_dispatch"]["next_attempt_at"].as_string(),
        DateTime(timezone=True),
    )
    query = (
        select(ReportRender)
        .where(
            ReportRender.status == "pending",
            or_(due.is_(None), due <= func.clock_timestamp()),
        )
        .order_by(ReportRender.updated_at, ReportRender.id)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    return list(await session.scalars(query))


def _dispatch_identity(render_id: uuid.UUID, token: str) -> ColumnElement[bool]:
    return and_(
        ReportRender.id == render_id,
        ReportRender.status == "pending",
        ReportRender.result_json["_dispatch"]["token"].as_string() == token,
        cast(
            ReportRender.result_json["_dispatch"][
                "next_attempt_at"
            ].as_string(),
            DateTime(timezone=True),
        )
        > func.clock_timestamp(),
    )


async def owns_dispatch(
    session: AsyncSession, render_id: uuid.UUID, token: str
) -> bool:
    return (
        await session.scalar(
            select(ReportRender.id).where(_dispatch_identity(render_id, token))
        )
        is not None
    )


async def save_dispatch(
    session: AsyncSession,
    render_id: uuid.UUID,
    token: str,
    payload: dict[str, object],
) -> bool:
    result = await session.execute(
        update(ReportRender)
        .where(_dispatch_identity(render_id, token))
        .values(result_json=payload, updated_at=func.clock_timestamp())
        .returning(ReportRender.id)
    )
    return result.scalar_one_or_none() is not None


async def active_count(session: AsyncSession) -> int:
    await session.execute(
        select(
            func.pg_advisory_xact_lock(func.hashtextextended(_CAPACITY_LOCK, 0))
        )
    )
    return (
        await session.scalar(
            select(func.count())
            .select_from(ReportRender)
            .where(ReportRender.status.in_(("pending", "running")))
        )
        or 0
    )
