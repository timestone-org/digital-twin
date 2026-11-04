"""定时规则的加锁读取与有界到期认领。"""

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.models.schedule import ModelingSchedule


async def clock(session: AsyncSession) -> datetime:
    value: object = (
        await session.execute(select(func.clock_timestamp()))
    ).scalar_one()
    if not isinstance(value, datetime):
        raise RuntimeError("database clock is unavailable")
    return value


async def get(
    session: AsyncSession, pipeline_id: uuid.UUID, *, should_lock: bool = False
) -> ModelingSchedule | None:
    statement = select(ModelingSchedule).where(
        ModelingSchedule.pipeline_id == pipeline_id
    )
    if should_lock:
        statement = statement.with_for_update()
    return (await session.execute(statement)).scalar_one_or_none()


async def due(session: AsyncSession, now: datetime) -> ModelingSchedule | None:
    statement = (
        select(ModelingSchedule)
        .where(ModelingSchedule.is_enabled, ModelingSchedule.next_run_at <= now)
        .order_by(ModelingSchedule.next_run_at, ModelingSchedule.pipeline_id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    return (await session.execute(statement)).scalar_one_or_none()
