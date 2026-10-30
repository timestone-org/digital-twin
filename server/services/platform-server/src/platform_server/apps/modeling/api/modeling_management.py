"""模型归档、恢复、部署切换及其历史接口。"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, CursorPage, ok
from platform_server.apps.modeling.catalog import MODELING_VIEW
from platform_server.apps.modeling.configuration_deps import (
    ConfigurationWriteContext,
    get_instance_publish,
    get_instance_write,
)
from platform_server.apps.modeling.deps import get_session, require
from platform_server.apps.modeling.schemas.deployment import ModelDeploymentOut
from platform_server.apps.modeling.schemas.management import (
    ArchiveIn,
    CursorListQuery,
    DeploymentRollbackIn,
    DeploymentSwitchIn,
    DeploymentSwitchOut,
)
from platform_server.apps.modeling.schemas.model import ModelVersionOut
from platform_server.apps.modeling.schemas.template import ModelingInstanceOut
from platform_server.apps.modeling.services import (
    deployment_switch,
    management_queries,
    management_state,
)
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=API_PREFIX, tags=["modeling-management"])
SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]
WriteDep = Annotated[ConfigurationWriteContext, Depends(get_instance_write)]
PublishDep = Annotated[ConfigurationWriteContext, Depends(get_instance_publish)]


@router.post(
    "/modeling-instances/{instance_id}:archive",
    response_model=ApiResponse[ModelingInstanceOut],
)
async def archive_instance(
    instance_id: uuid.UUID,
    payload: ArchiveIn,
    session: SessionDep,
    write: WriteDep,
) -> ApiResponse[ModelingInstanceOut]:
    return ok(
        await write.gate.run_once(
            endpoint=f"modeling.archive_instance.{instance_id}",
            model=ModelingInstanceOut,
            action=lambda: management_state.set_instance_archive(
                session, instance_id, payload, write.actor, datetime.now(UTC)
            ),
        )
    )


@router.post(
    "/modeling-instances/{instance_id}:restore",
    response_model=ApiResponse[ModelingInstanceOut],
)
async def restore_instance(
    instance_id: uuid.UUID,
    payload: ArchiveIn,
    session: SessionDep,
    write: WriteDep,
) -> ApiResponse[ModelingInstanceOut]:
    return ok(
        await write.gate.run_once(
            endpoint=f"modeling.restore_instance.{instance_id}",
            model=ModelingInstanceOut,
            action=lambda: management_state.set_instance_archive(
                session, instance_id, payload, write.actor, None
            ),
        )
    )


@router.post(
    "/modeling-model-versions/{version_id}:archive",
    response_model=ApiResponse[ModelVersionOut],
)
async def archive_version(
    version_id: uuid.UUID, session: SessionDep, write: PublishDep
) -> ApiResponse[ModelVersionOut]:
    return ok(
        await write.gate.run_once(
            endpoint=f"modeling.archive_version.{version_id}",
            model=ModelVersionOut,
            action=lambda: management_state.set_version_archive(
                session, version_id, write.actor, datetime.now(UTC)
            ),
        )
    )


@router.post(
    "/modeling-model-versions/{version_id}:restore",
    response_model=ApiResponse[ModelVersionOut],
)
async def restore_version(
    version_id: uuid.UUID, session: SessionDep, write: PublishDep
) -> ApiResponse[ModelVersionOut]:
    return ok(
        await write.gate.run_once(
            endpoint=f"modeling.restore_version.{version_id}",
            model=ModelVersionOut,
            action=lambda: management_state.set_version_archive(
                session, version_id, write.actor, None
            ),
        )
    )


@router.post(
    "/modeling-deployments/{deployment_id}:switch",
    response_model=ApiResponse[ModelDeploymentOut],
)
async def switch_deployment(
    deployment_id: uuid.UUID,
    payload: DeploymentSwitchIn,
    session: SessionDep,
    write: PublishDep,
) -> ApiResponse[ModelDeploymentOut]:
    return ok(
        await write.gate.run_once(
            endpoint=f"modeling.switch_deployment.{deployment_id}",
            model=ModelDeploymentOut,
            action=lambda: deployment_switch.switch_deployment(
                session, deployment_id, payload, write.actor
            ),
        )
    )


@router.post(
    "/modeling-deployments/{deployment_id}:rollback",
    response_model=ApiResponse[ModelDeploymentOut],
)
async def rollback_deployment(
    deployment_id: uuid.UUID,
    payload: DeploymentRollbackIn,
    session: SessionDep,
    write: PublishDep,
) -> ApiResponse[ModelDeploymentOut]:
    return ok(
        await write.gate.run_once(
            endpoint=f"modeling.rollback_deployment.{deployment_id}",
            model=ModelDeploymentOut,
            action=lambda: deployment_switch.rollback_deployment(
                session, deployment_id, payload, write.actor
            ),
        )
    )


@router.get(
    "/modeling-deployments/{deployment_id}/switches",
    response_model=ApiResponse[CursorPage[DeploymentSwitchOut]],
)
async def list_switches(
    deployment_id: uuid.UUID,
    session: SessionDep,
    _viewer: ViewDep,
    query: Annotated[CursorListQuery, Query()],
) -> ApiResponse[CursorPage[DeploymentSwitchOut]]:
    return ok(
        await deployment_switch.list_switches(session, deployment_id, query)
    )


@router.get(
    "/modeling-model-versions/{version_id}/deployments",
    response_model=ApiResponse[CursorPage[ModelDeploymentOut]],
)
async def list_version_deployments(
    version_id: uuid.UUID,
    session: SessionDep,
    _viewer: ViewDep,
    query: Annotated[CursorListQuery, Query()],
) -> ApiResponse[CursorPage[ModelDeploymentOut]]:
    return ok(
        await management_queries.list_version_deployments(
            session, version_id, query
        )
    )
