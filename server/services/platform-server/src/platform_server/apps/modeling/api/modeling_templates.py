"""建模模板发布与完整配置 Schema。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.modeling.catalog import MODELING_VIEW
from platform_server.apps.modeling.configuration_deps import (
    ConfigurationWriteContext,
    get_template_write,
)
from platform_server.apps.modeling.deps import (
    WriteGate,
    get_pipeline_import_context,
    get_session,
    require,
)
from platform_server.apps.modeling.schemas.pipeline import PipelineOut
from platform_server.apps.modeling.schemas.template import (
    ModelingConfigurationOut,
    ModelingTemplateCreateIn,
    ModelingTemplateOut,
    ModelingTemplateUpdateIn,
    ModelingWorkflowCreateIn,
)
from platform_server.apps.modeling.services import template_service
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.task_replay import (
    TaskCommand,
    run_task_once,
)
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/modeling-templates", tags=["modeling-template"]
)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]
ManageDep = Annotated[ConfigurationWriteContext, Depends(get_template_write)]
WorkflowDep = Annotated[WriteGate, Depends(get_pipeline_import_context)]


@router.get(
    "",
    response_model=ApiResponse[Page[ModelingTemplateOut]],
    summary="建模模板列表",
)
async def list_templates(
    session: SessionDep, page: PageDep, _viewer: ViewDep, q: str | None = None
) -> ApiResponse[Page[ModelingTemplateOut]]:
    return ok(await template_service.list_templates(session, q, page))


@router.post(
    "",
    response_model=ApiResponse[ModelingTemplateOut],
    status_code=201,
    summary="发布建模模板",
)
async def create_template(
    payload: ModelingTemplateCreateIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[ModelingTemplateOut]:
    command = TaskCommand(
        endpoint="modeling.create_template",
        model=ModelingTemplateOut,
        action=lambda: template_service.create_template(
            session, payload, write.actor
        ),
    )
    created = await run_task_once(session, write.gate, command)
    response.headers["Location"] = (
        f"{API_PREFIX}/modeling-templates/{created.id}"
    )
    return ok(created)


@router.get(
    "/{template_id}",
    response_model=ApiResponse[ModelingTemplateOut],
    summary="建模模板详情",
)
async def get_template(
    template_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[ModelingTemplateOut]:
    return ok(await template_service.get_template(session, template_id))


@router.post(
    "/{template_id}:create-workflow",
    response_model=ApiResponse[PipelineOut],
    status_code=201,
)
async def create_workflow(
    template_id: uuid.UUID,
    payload: ModelingWorkflowCreateIn,
    session: SessionDep,
    response: Response,
    write: WorkflowDep,
) -> ApiResponse[PipelineOut]:
    actor = Actor(str(write.caller.user_id), write.caller.username)
    result = await write.run_once(
        endpoint=f"modeling.create_workflow_from_template.{template_id}",
        model=PipelineOut,
        action=lambda: template_service.create_workflow(
            session, template_id, payload, actor
        ),
    )
    response.headers["Location"] = (
        f"{API_PREFIX}/modeling-pipelines/{result.id}"
    )
    return ok(result)


@router.get(
    "/{template_id}/configuration",
    response_model=ApiResponse[ModelingConfigurationOut],
    summary="模板全部配置与 Schema",
)
async def get_configuration(
    template_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[ModelingConfigurationOut]:
    return ok(await template_service.get_configuration(session, template_id))


@router.patch(
    "/{template_id}",
    response_model=ApiResponse[ModelingTemplateOut],
    summary="启停建模模板",
)
async def update_template(
    template_id: uuid.UUID,
    payload: ModelingTemplateUpdateIn,
    session: SessionDep,
    write: ManageDep,
) -> ApiResponse[ModelingTemplateOut]:
    return ok(
        await template_service.update_template(
            session, template_id, payload, write.actor
        )
    )
