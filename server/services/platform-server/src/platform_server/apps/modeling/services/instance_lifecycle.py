"""实例训练与部署复用既有执行、版本及服务机制。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.errors import ModelVersionUnservable
from platform_server.apps.modeling.schemas import (
    ModelDeploymentCreateIn,
    ModelDeploymentOut,
    RunOut,
    RunStartIn,
)
from platform_server.apps.modeling.schemas.template import (
    ModelingInstanceDeployIn,
)
from platform_server.apps.modeling.services import (
    deployment_service,
    model_service,
    run_service,
)
from platform_server.apps.modeling.services.instance_service import (
    lock_instance,
    require_instance,
)
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.run_service import RunContext
from platform_server.apps.modeling.services.template_service import record_audit


async def train_instance(
    session: AsyncSession,
    instance_id: uuid.UUID,
    payload: RunStartIn,
    context: RunContext,
) -> RunOut:
    await lock_instance(session, instance_id)
    return await run_service.start_run(
        session, pipeline_id=instance_id, payload=payload, context=context
    )


async def deploy_instance(
    session: AsyncSession,
    instance_id: uuid.UUID,
    payload: ModelingInstanceDeployIn,
    actor: Actor,
) -> ModelDeploymentOut:
    await require_instance(session, instance_id)
    version = await model_service.get_version(session, payload.model_version_id)
    if version.pipeline_id != instance_id or not version.is_servable:
        raise ModelVersionUnservable("请选择本模型实例下可部署的模型版本")
    result = await deployment_service.create_deployment(
        session,
        payload=ModelDeploymentCreateIn(**payload.model_dump()),
        actor=actor,
    )
    record_audit(
        session,
        actor,
        "instance_deployed",
        instance_id,
        (
            None,
            {
                "deployment_id": str(result.id),
                "model_version_id": str(version.id),
            },
        ),
    )
    return result
