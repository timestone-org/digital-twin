"""部署切换记录的持久化与有界读取。"""

import uuid

from sqlalchemy import literal, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.models.deployment_switch import (
    ModelingDeploymentSwitch,
)
from platform_server.apps.modeling.schemas.management import ManagementCursor


async def get_switch(
    session: AsyncSession, identity: uuid.UUID
) -> ModelingDeploymentSwitch | None:
    return await session.get(ModelingDeploymentSwitch, identity)


async def list_switches(
    session: AsyncSession,
    identity: uuid.UUID,
    limit: int,
    anchor: ManagementCursor | None,
) -> list[ModelingDeploymentSwitch]:
    row = ModelingDeploymentSwitch
    statement = select(row).where(row.deployment_id == identity)
    if anchor:
        statement = statement.where(
            tuple_(row.created_at, row.id)
            < tuple_(literal(anchor.created_at), literal(anchor.identity))
        )
    rows = await session.scalars(
        statement.order_by(row.created_at.desc(), row.id.desc()).limit(
            limit + 1
        )
    )
    return list(rows.all())


def add_switch(session: AsyncSession, row: ModelingDeploymentSwitch) -> None:
    session.add(row)
