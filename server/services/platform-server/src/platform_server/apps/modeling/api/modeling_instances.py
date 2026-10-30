"""按模板建模、集中配置、训练与部署的第三方及页面共用接口。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, CursorPage, Page, PageParams, ok, page_params
from platform_server.apps.modeling.catalog import MODELING_VIEW
from platform_server.apps.modeling.configuration_deps import (
    ConfigurationWriteContext,
    get_instance_publish,
    get_instance_write,
)
from platform_server.apps.modeling.deps import (
    get_run_context,
    get_session,
    require,
)
from platform_server.apps.modeling.schemas import (
    ModelDeploymentOut,
    RunOut,
    RunStartIn,
)
from platform_server.apps.modeling.schemas.management import InstanceListQuery
from platform_server.apps.modeling.schemas.template import (
    ModelingConfigurationOut,
    ModelingInstanceConfigureIn,
    ModelingInstanceCreateIn,
    ModelingInstanceDeployIn,
    ModelingInstanceOut,
)
from platform_server.apps.modeling.services import (
    RunContext,
    instance_lifecycle,
    instance_service,
    management_queries,
)
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/modeling-instances", tags=["modeling-instance"]
)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]
WriteDep = Annotated[ConfigurationWriteContext, Depends(get_instance_write)]
PublishDep = Annotated[ConfigurationWriteContext, Depends(get_instance_publish)]
RunDep = Annotated[RunContext, Depends(get_run_context)]


@router.get(
    "",
    response_model=ApiResponse[
        Page[ModelingInstanceOut] | CursorPage[ModelingInstanceOut]
    ],
    summary="模型实例列表",
)
async def list_instances(
    session: SessionDep,
    _viewer: ViewDep,
    query: Annotated[InstanceListQuery, Query()],
) -> ApiResponse[Page[ModelingInstanceOut] | CursorPage[ModelingInstanceOut]]:
    return ok(await management_queries.list_instances(session, query))


@router.post(
    "",
    response_model=ApiResponse[ModelingInstanceOut],
    status_code=201,
    summary="通过模板创建模型",
)
async def create_instance(
    payload: ModelingInstanceCreateIn,
    session: SessionDep,
    response: Response,
    write: WriteDep,
) -> ApiResponse[ModelingInstanceOut]:
    created = await write.gate.run_once(
        endpoint="modeling.create_instance",
        model=ModelingInstanceOut,
        action=lambda: instance_service.create_instance(
            session, payload, write.actor
        ),
    )
    response.headers["Location"] = (
        f"{API_PREFIX}/modeling-instances/{created.id}"
    )
    return ok(created)


@router.get(
    "/{instance_id}",
    response_model=ApiResponse[ModelingInstanceOut],
    summary="模型实例详情",
)
async def get_instance(
    instance_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[ModelingInstanceOut]:
    return ok(await instance_service.get_instance(session, instance_id))


@router.get(
    "/{instance_id}/configuration",
    response_model=ApiResponse[ModelingConfigurationOut],
    summary="模型全部配置与 Schema",
)
async def get_configuration(
    instance_id: uuid.UUID,
    session: SessionDep,
    _viewer: ViewDep,
    run_id: uuid.UUID | None = None,
) -> ApiResponse[ModelingConfigurationOut]:
    return ok(
        await instance_service.get_configuration(session, instance_id, run_id)
    )


@router.put(
    "/{instance_id}/configuration",
    response_model=ApiResponse[ModelingInstanceOut],
    summary="一次配置模型全部参数",
)
async def configure_instance(
    instance_id: uuid.UUID,
    payload: ModelingInstanceConfigureIn,
    session: SessionDep,
    write: WriteDep,
) -> ApiResponse[ModelingInstanceOut]:
    return ok(
        await write.gate.run_once(
            endpoint=f"modeling.configure_instance.{instance_id}",
            model=ModelingInstanceOut,
            action=lambda: instance_service.configure_instance(
                session, instance_id, payload, write.actor
            ),
        )
    )


@router.post(
    "/{instance_id}:train",
    response_model=ApiResponse[RunOut],
    status_code=202,
    summary="训练模型实例",
)
async def train_instance(
    instance_id: uuid.UUID,
    payload: RunStartIn,
    session: SessionDep,
    write: WriteDep,
    context: RunDep,
) -> ApiResponse[RunOut]:
    run = await write.gate.run_once(
        endpoint=f"modeling.train_instance.{instance_id}",
        model=RunOut,
        action=lambda: instance_lifecycle.train_instance(
            session, instance_id, payload, context
        ),
    )
    return ok(run)


@router.post(
    "/{instance_id}:deploy",
    response_model=ApiResponse[ModelDeploymentOut],
    status_code=201,
    summary="部署模型实例的指定版本",
)
async def deploy_instance(
    instance_id: uuid.UUID,
    payload: ModelingInstanceDeployIn,
    session: SessionDep,
    write: PublishDep,
    response: Response,
) -> ApiResponse[ModelDeploymentOut]:
    deployed = await write.gate.run_once(
        endpoint=f"modeling.deploy_instance.{instance_id}",
        model=ModelDeploymentOut,
        action=lambda: instance_lifecycle.deploy_instance(
            session, instance_id, payload, write.actor
        ),
    )
    response.headers["Location"] = (
        f"{API_PREFIX}/modeling-deployments/{deployed.id}"
    )
    return ok(deployed)
