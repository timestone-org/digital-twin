"""报告模板与审计的数据库访问。"""

import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.report.models import (
    ReportAudit,
    ReportRender,
    ReportSchedule,
    ReportTemplate,
)


async def page(
    session: AsyncSession, offset: int, limit: int
) -> tuple[list[ReportTemplate], int]:
    query = select(ReportTemplate).order_by(
        ReportTemplate.created_at.desc(), ReportTemplate.id.desc()
    )
    rows = await session.scalars(query.offset(offset).limit(limit))
    total = await session.scalar(
        select(func.count()).select_from(ReportTemplate)
    )
    return list(rows), total or 0


async def get(
    session: AsyncSession, template_id: uuid.UUID
) -> ReportTemplate | None:
    return await session.get(ReportTemplate, template_id)


async def save_version(
    session: AsyncSession,
    template_id: uuid.UUID,
    version: int,
    changes: dict[str, object],
) -> bool:
    result = await session.execute(
        update(ReportTemplate)
        .where(
            ReportTemplate.id == template_id,
            ReportTemplate.row_version == version,
        )
        .values(**changes, row_version=version + 1)
        .returning(ReportTemplate.id)
    )
    return result.scalar_one_or_none() is not None


async def has_children(session: AsyncSession, template_id: uuid.UUID) -> bool:
    rules = await session.scalar(
        select(ReportSchedule.id)
        .where(ReportSchedule.template_id == template_id)
        .limit(1)
    )
    renders = await session.scalar(
        select(ReportRender.id)
        .where(ReportRender.template_id == template_id)
        .limit(1)
    )
    return rules is not None or renders is not None


async def add(session: AsyncSession, row: ReportTemplate) -> ReportTemplate:
    session.add(row)
    await session.flush()
    return row


async def delete(session: AsyncSession, row: ReportTemplate) -> None:
    await session.delete(row)
    await session.flush()


def audit(session: AsyncSession, row: ReportAudit) -> None:
    session.add(row)
