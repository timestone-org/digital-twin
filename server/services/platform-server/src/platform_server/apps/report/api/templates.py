"""模板管理、校验与试算 HTTP 面。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.report.catalog import REPORT_VIEW
from platform_server.apps.report.deps import manage_gate
from platform_server.apps.report.schemas.preview import (
    PreviewIn,
    PreviewOut,
    ValidationOut,
)
from platform_server.apps.report.schemas.template import (
    ReportTemplateCreateIn,
    ReportTemplateOut,
    ReportTemplateSummaryOut,
    TemplateBody,
    TemplateUpdateIn,
)
from platform_server.apps.report.services import template_service
from platform_server.apps.report.services.document import validate_template
from platform_server.apps.report.services.template_preview import (
    preview_template as run_preview,
)
from platform_server.container import Container
from platform_server.deps import WriteGate, get_container, get_session, require
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/report-templates", tags=["report-template"]
)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(REPORT_VIEW))]
ManageDep = Annotated[WriteGate, Depends(manage_gate)]
ContainerDep = Annotated[Container, Depends(get_container)]


@router.get("", response_model=ApiResponse[Page[ReportTemplateSummaryOut]])
async def list_templates(
    session: SessionDep, page: PageDep, _viewer: ViewDep
) -> ApiResponse[Page[ReportTemplateSummaryOut]]:
    return ok(await template_service.list_templates(session, page))


@router.post("", status_code=201, response_model=ApiResponse[ReportTemplateOut])
async def create_template(
    payload: ReportTemplateCreateIn,
    session: SessionDep,
    gate: ManageDep,
    response: Response,
) -> ApiResponse[ReportTemplateOut]:
    result = await gate.run_once(
        endpoint="report-templates:create",
        model=ReportTemplateOut,
        action=lambda: template_service.create_template(
            session, payload, str(gate.caller.user_id)
        ),
    )
    response.headers["Location"] = f"{API_PREFIX}/report-templates/{result.id}"
    return ok(result)


@router.get("/{template_id}", response_model=ApiResponse[ReportTemplateOut])
async def read_template(
    template_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[ReportTemplateOut]:
    return ok(await template_service.read_template(session, template_id))


@router.put("/{template_id}", response_model=ApiResponse[ReportTemplateOut])
async def update_template(
    template_id: uuid.UUID,
    payload: TemplateUpdateIn,
    session: SessionDep,
    gate: ManageDep,
) -> ApiResponse[ReportTemplateOut]:
    return ok(
        await template_service.update_template(
            session, template_id, payload, str(gate.caller.user_id)
        )
    )


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: uuid.UUID, session: SessionDep, gate: ManageDep
) -> Response:
    await template_service.delete_template(
        session, template_id, str(gate.caller.user_id)
    )
    return Response(status_code=204)


@router.post(":validate", response_model=ApiResponse[ValidationOut])
async def validate(
    payload: TemplateBody, _gate: ManageDep
) -> ApiResponse[ValidationOut]:
    return ok(validate_template(payload))


@router.post("/{template_id}:preview", response_model=ApiResponse[PreviewOut])
async def preview_template(
    template_id: uuid.UUID,
    payload: PreviewIn,
    session: SessionDep,
    _gate: ManageDep,
    container: ContainerDep,
) -> ApiResponse[PreviewOut]:
    return ok(
        await run_preview(
            session,
            template_id,
            payload,
            container.settings.dataset_bucket_timezone,
        )
    )
