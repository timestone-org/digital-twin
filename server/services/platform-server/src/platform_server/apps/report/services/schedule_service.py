"""定时规则管理的事务边界。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import Page, PageParams
from platform_server.apps.report.crud import schedules
from platform_server.apps.report.errors import ReportConflict, ReportNotFound
from platform_server.apps.report.models import ReportSchedule
from platform_server.apps.report.schemas.jobs import (
    ScheduleCreateIn,
    ScheduleOut,
    ScheduleUpdateIn,
)
from platform_server.apps.report.services.template_service import (
    record_audit,
    require_template,
)


async def list_schedules(
    session: AsyncSession, page: PageParams
) -> Page[ScheduleOut]:
    rows, total = await schedules.page(session, page.offset, page.size)
    return Page[ScheduleOut](
        items=[ScheduleOut.model_validate(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def create_schedule(
    session: AsyncSession, payload: ScheduleCreateIn, actor: str
) -> ScheduleOut:
    await require_template(session, payload.template_id)
    row = await schedules.add(session, ReportSchedule(**payload.model_dump()))
    record_audit(
        session,
        actor,
        "schedule_created",
        row.id,
        (None, payload.model_dump(mode="json")),
    )
    return ScheduleOut.model_validate(row)


async def update_schedule(
    session: AsyncSession,
    schedule_id: uuid.UUID,
    payload: ScheduleUpdateIn,
    actor: str,
) -> ScheduleOut:
    row = await schedules.get(session, schedule_id)
    if row is None:
        raise ReportNotFound("定时规则不存在")
    before = ScheduleOut.model_validate(row).model_dump(mode="json")
    changes = payload.model_dump(exclude={"expected_version"})
    if row.granularity != payload.granularity:
        changes["last_run_period"] = None
    if not await schedules.save_version(
        session, schedule_id, payload.expected_version, changes
    ):
        raise ReportConflict("规则已被其他人修改，请重新加载")
    await session.refresh(row)
    record_audit(session, actor, "schedule_updated", row.id, (before, changes))
    return ScheduleOut.model_validate(row)


async def delete_schedule(
    session: AsyncSession, schedule_id: uuid.UUID, actor: str
) -> None:
    row = await schedules.get(session, schedule_id)
    if row is None:
        return
    if not await schedules.delete(session, row):
        raise ReportConflict("规则已有生成历史，请停用规则以保留历史")
    record_audit(session, actor, "schedule_deleted", row.id, (None, None))
