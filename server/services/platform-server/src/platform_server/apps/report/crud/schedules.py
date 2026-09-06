"""定时规则的有界查询与原子版本更新。"""

import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.report.models import ReportRender, ReportSchedule


async def get(
    session: AsyncSession, schedule_id: uuid.UUID
) -> ReportSchedule | None:
    return await session.get(ReportSchedule, schedule_id)


async def page(
    session: AsyncSession, offset: int, limit: int
) -> tuple[list[ReportSchedule], int]:
    query = (
        select(ReportSchedule)
        .order_by(ReportSchedule.created_at.desc(), ReportSchedule.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return (
        list(await session.scalars(query)),
        await session.scalar(select(func.count()).select_from(ReportSchedule))
        or 0,
    )


async def add(session: AsyncSession, row: ReportSchedule) -> ReportSchedule:
    session.add(row)
    await session.flush()
    return row


async def save_version(
    session: AsyncSession,
    schedule_id: uuid.UUID,
    version: int,
    changes: dict[str, object],
) -> bool:
    found = await session.execute(
        update(ReportSchedule)
        .where(
            ReportSchedule.id == schedule_id,
            ReportSchedule.row_version == version,
        )
        .values(**changes, row_version=version + 1)
        .returning(ReportSchedule.id)
    )
    return found.scalar_one_or_none() is not None


async def delete(session: AsyncSession, row: ReportSchedule) -> bool:
    if await session.scalar(
        select(ReportRender.id)
        .where(ReportRender.schedule_id == row.id)
        .limit(1)
    ):
        return False
    await session.delete(row)
    return True


async def enabled_page(
    session: AsyncSession, after: uuid.UUID | None, limit: int
) -> list[ReportSchedule]:
    query = select(ReportSchedule).where(ReportSchedule.is_enabled.is_(True))
    if after:
        query = query.where(ReportSchedule.id > after)
    return list(
        await session.scalars(query.order_by(ReportSchedule.id).limit(limit))
    )
