"""管理状态的行锁与引用守卫查询。"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.models import (
    ModelingBinding,
    ModelingDeployment,
    ModelingModelVersion,
    ModelingRuleVersion,
    ModelingRun,
    ModelVersion,
)
from platform_server.apps.modeling.models.deployment_switch import (
    ModelingDeploymentSwitch,
)
from platform_server.apps.modeling.models.template import ModelingInstance
from platform_server.apps.modeling.protocols import ACTIVE_RUN_STATUSES


async def lock_instance(
    session: AsyncSession, identity: uuid.UUID
) -> ModelingInstance | None:
    return await session.get(
        ModelingInstance, identity, with_for_update=True, populate_existing=True
    )


async def lock_version(
    session: AsyncSession, identity: uuid.UUID
) -> ModelVersion | None:
    trained = await session.get(
        ModelingModelVersion,
        identity,
        with_for_update=True,
        populate_existing=True,
    )
    return trained or await session.get(
        ModelingRuleVersion,
        identity,
        with_for_update=True,
        populate_existing=True,
    )


async def version_references(session: AsyncSession, identity: uuid.UUID) -> int:
    deployments = await session.scalar(
        select(func.count())
        .select_from(ModelingDeployment)
        .where(
            (ModelingDeployment.model_version_id == identity)
            | (ModelingDeployment.rule_version_id == identity)
        )
    )
    bindings = await session.scalar(
        select(func.count())
        .select_from(ModelingBinding)
        .where(ModelingBinding.model_version_id == identity)
    )
    return int(deployments or 0) + int(bindings or 0)


async def instance_references(
    session: AsyncSession, identity: uuid.UUID
) -> int:
    runs = await session.scalar(
        select(func.count())
        .select_from(ModelingRun)
        .where(
            ModelingRun.pipeline_id == identity,
            ModelingRun.status.in_(ACTIVE_RUN_STATUSES),
        )
    )
    models = select(ModelingModelVersion.id).where(
        ModelingModelVersion.pipeline_id == identity
    )
    rules = select(ModelingRuleVersion.id).where(
        ModelingRuleVersion.pipeline_id == identity
    )
    deployments = await session.scalar(
        select(func.count())
        .select_from(ModelingDeployment)
        .where(
            ModelingDeployment.model_version_id.in_(models)
            | ModelingDeployment.rule_version_id.in_(rules)
        )
    )
    bindings = await session.scalar(
        select(func.count())
        .select_from(ModelingBinding)
        .where(ModelingBinding.model_version_id.in_(models))
    )
    return int(runs or 0) + int(deployments or 0) + int(bindings or 0)


async def version_history_references(
    session: AsyncSession, identity: uuid.UUID
) -> int:
    row = ModelingDeploymentSwitch
    return int(
        await session.scalar(
            select(func.count())
            .select_from(row)
            .where(
                (row.from_model_id == identity)
                | (row.from_rule_id == identity)
                | (row.to_model_id == identity)
                | (row.to_rule_id == identity)
            )
        )
        or 0
    )
