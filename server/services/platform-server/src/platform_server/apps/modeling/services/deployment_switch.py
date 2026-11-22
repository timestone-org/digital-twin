"""受修订、归属及签名保护的部署版本切换。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import CursorPage
from platform_server.apps.modeling.crud import deployment_switch as switches
from platform_server.apps.modeling.management_errors import (
    DeploymentSwitchNotFound,
)
from platform_server.apps.modeling.schemas.deployment import ModelDeploymentOut
from platform_server.apps.modeling.schemas.management import (
    DeploymentRollbackIn,
    DeploymentSwitchIn,
    DeploymentSwitchOut,
    ManagementListQuery,
)
from platform_server.apps.modeling.services import deployment_service
from platform_server.apps.modeling.services.deployment_version_change import (
    change_version,
)
from platform_server.apps.modeling.services.management_cursor import (
    paginate,
    read_cursor,
)
from platform_server.apps.modeling.services.pipeline_service import Actor


async def switch_deployment(
    session: AsyncSession,
    identity: uuid.UUID,
    payload: DeploymentSwitchIn,
    actor: Actor,
) -> ModelDeploymentOut:
    return await _switch(session, identity, payload, actor, None)


async def rollback_deployment(
    session: AsyncSession,
    identity: uuid.UUID,
    payload: DeploymentRollbackIn,
    actor: Actor,
) -> ModelDeploymentOut:
    previous = await switches.get_switch(session, payload.switch_id)
    if previous is None or previous.deployment_id != identity:
        raise DeploymentSwitchNotFound("部署切换记录不存在")
    target = previous.from_model_id or previous.from_rule_id
    if target is None:
        raise DeploymentSwitchNotFound("切换记录没有可回滚版本")
    command = DeploymentSwitchIn(
        expected_revision=payload.expected_revision,
        model_version_id=target,
        is_signature_change_confirmed=payload.is_signature_change_confirmed,
    )
    return await _switch(session, identity, command, actor, previous.id)


async def _switch(
    session: AsyncSession,
    identity: uuid.UUID,
    payload: DeploymentSwitchIn,
    actor: Actor,
    rollback_of: uuid.UUID | None,
) -> ModelDeploymentOut:
    deployment = await deployment_service.lock_deployment(session, identity)
    await change_version(session, deployment, payload, actor, rollback_of)
    await session.flush()
    return await deployment_service.get_deployment(session, identity)


async def list_switches(
    session: AsyncSession, identity: uuid.UUID, query: ManagementListQuery
) -> CursorPage[DeploymentSwitchOut]:
    await deployment_service.get_deployment(session, identity)
    query = query.model_copy(update={"pagination": "cursor"})
    resource = f"deployment-switches:{identity}"
    rows = await switches.list_switches(
        session, identity, query.limit, read_cursor(query, resource)
    )
    items = [
        DeploymentSwitchOut(
            id=row.id,
            deployment_id=row.deployment_id,
            deployment_code=row.deployment_code,
            from_model_version_id=row.from_version_id,
            to_model_version_id=row.to_version_id,
            revision=row.revision,
            rollback_of_id=row.rollback_of_id,
            is_signature_change_confirmed=row.is_signature_change_confirmed,
            created_by_name=row.created_by_name,
            created_at=row.created_at,
        )
        for row in rows
    ]
    result = paginate(items, 0, query, resource)
    if not isinstance(result, CursorPage):
        raise RuntimeError("切换历史必须使用游标分页")
    return result
