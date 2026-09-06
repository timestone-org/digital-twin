"""生成任务的原子认领和有界游标查询。"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.report.models import ReportRender


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


async def stale(
    session: AsyncSession, cutoff: datetime, limit: int
) -> list[ReportRender]:
    query = (
        select(ReportRender)
        .where(
            or_(
                and_(
                    ReportRender.status == "running",
                    ReportRender.updated_at < cutoff,
                ),
                and_(
                    ReportRender.status == "pending",
                    ReportRender.created_at < cutoff - timedelta(days=1),
                ),
            ),
        )
        .order_by(ReportRender.updated_at)
        .limit(limit)
    )
    return list(await session.scalars(query))


async def active_count(session: AsyncSession) -> int:
    return (
        await session.scalar(
            select(func.count())
            .select_from(ReportRender)
            .where(ReportRender.status.in_(("pending", "running")))
        )
        or 0
    )
