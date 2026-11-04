"""工作流定时训练规则的读取、覆盖与审计。"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.errors import PermissionDenied
from platform_server.apps.modeling.catalog import MODELING_PUBLISH
from platform_server.apps.modeling.crud import run_crud
from platform_server.apps.modeling.crud import schedule as schedules
from platform_server.apps.modeling.crud.template import lock_pipeline
from platform_server.apps.modeling.models.schedule import ModelingSchedule
from platform_server.apps.modeling.schedule_errors import (
    ScheduleInvalid,
    ScheduleRevisionConflict,
)
from platform_server.apps.modeling.schemas.schedule import (
    ModelingScheduleIn,
    ModelingScheduleOut,
)
from platform_server.apps.modeling.services.management_guard import (
    require_active_instance,
)
from platform_server.apps.modeling.services.pipeline_service import (
    Actor,
    require_pipeline,
)
from platform_server.apps.modeling.services.template_service import record_audit


async def get_schedule(
    session: AsyncSession, pipeline_id: uuid.UUID
) -> ModelingScheduleOut:
    await require_pipeline(session, pipeline_id)
    row = await schedules.get(session, pipeline_id)
    if row is None:
        return ModelingScheduleOut(pipeline_id=pipeline_id)
    result = ModelingScheduleOut.model_validate(row)
    if row.last_run_id is not None:
        run = await run_crud.get(session, row.last_run_id)
        if run is not None and run.status == "failed":
            result.last_error = "最近一次定时训练失败，请查看训练记录"
        elif run is not None and run.publication_status == "failed":
            result.last_error = (
                run.publication_error
                or "训练成功，但模型发布失败，请查看训练记录"
            )
    return result


async def save_schedule(
    session: AsyncSession,
    pipeline_id: uuid.UUID,
    payload: ModelingScheduleIn,
    caller: CallerContext,
) -> ModelingScheduleOut:
    if (
        payload.should_auto_publish
        and MODELING_PUBLISH not in caller.permissions
    ):
        raise PermissionDenied("自动发布需要模型发布权限")
    now = await schedules.clock(session)
    if payload.first_run_at is not None and payload.first_run_at <= now:
        raise ScheduleInvalid("首次执行时间必须晚于当前时间")
    await require_pipeline(session, pipeline_id)
    row = await schedules.get(session, pipeline_id, should_lock=True)
    if row is None:
        await lock_pipeline(session, pipeline_id)
        row = await schedules.get(session, pipeline_id, should_lock=True)
    revision = row.revision if row is not None else 0
    if payload.expected_revision != revision:
        raise ScheduleRevisionConflict("定时规则已被修改，请刷新后再保存")
    await require_active_instance(session, pipeline_id)
    before = (
        ModelingScheduleOut.model_validate(row).model_dump(mode="json")
        if row
        else None
    )
    if row is None:
        row = ModelingSchedule(pipeline_id=pipeline_id, revision=0)
        session.add(row)
    _apply(row, payload, caller, now)
    await session.flush()
    result = ModelingScheduleOut.model_validate(row)
    record_audit(
        session,
        Actor(str(caller.user_id), caller.username),
        "training_schedule_saved",
        pipeline_id,
        (before, result.model_dump(mode="json")),
    )
    return result


def _apply(
    row: ModelingSchedule,
    payload: ModelingScheduleIn,
    caller: CallerContext,
    now: datetime,
) -> None:
    should_reset = (
        not row.is_enabled or row.interval_minutes != payload.interval_minutes
    )
    if not payload.is_enabled:
        row.next_run_at = None
    elif payload.first_run_at is not None:
        row.next_run_at = payload.first_run_at.astimezone(UTC)
    elif should_reset or row.next_run_at is None:
        row.next_run_at = now + timedelta(minutes=payload.interval_minutes)
    row.is_enabled = payload.is_enabled
    row.interval_minutes = payload.interval_minutes
    row.auto_publish = payload.should_auto_publish
    row.actor_id = str(caller.user_id)
    row.actor_name = caller.username
    row.revision += 1
