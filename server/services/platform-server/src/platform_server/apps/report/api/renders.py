"""报告生成记录、提交及受独立权限保护的下载。"""

import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.objectstore import ObjectStore
from lib.web import ApiResponse, CursorPage, CursorParams, cursor_params, ok
from platform_server.apps.report.catalog import REPORT_RENDER, REPORT_VIEW
from platform_server.apps.report.deps import render_context
from platform_server.apps.report.schemas.jobs import (
    RenderCreateIn,
    RenderDetailOut,
    RenderOut,
    ReportApiConnectionOut,
    ReportRuntimeOut,
)
from platform_server.apps.report.services import render_service
from platform_server.apps.report.services.render_service import RenderContext
from platform_server.container import Container
from platform_server.deps import (
    get_container,
    get_object_store,
    get_session,
    require,
)
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/report-renders", tags=["report-render"]
)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[CursorParams, Depends(cursor_params)]
ViewDep = Annotated[CallerContext, Depends(require(REPORT_VIEW))]
RenderDep = Annotated[RenderContext, Depends(render_context)]
DownloadDep = Annotated[CallerContext, Depends(require(REPORT_RENDER))]
StoreDep = Annotated[ObjectStore, Depends(get_object_store)]
ContainerDep = Annotated[Container, Depends(get_container)]


@router.get("", response_model=ApiResponse[CursorPage[RenderOut]])
async def list_renders(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    template_id: uuid.UUID | None = None,
) -> ApiResponse[CursorPage[RenderOut]]:
    return ok(await render_service.list_renders(session, template_id, page))


@router.post("", status_code=202, response_model=ApiResponse[RenderOut])
async def start_render(
    payload: RenderCreateIn, session: SessionDep, context: RenderDep
) -> ApiResponse[RenderOut]:
    return ok(await render_service.start_render(session, payload, context))


@router.get("/{render_id}", response_model=ApiResponse[RenderDetailOut])
async def read_render(
    render_id: uuid.UUID, session: SessionDep, viewer: ViewDep
) -> ApiResponse[RenderDetailOut]:
    return ok(await render_service.read_render(session, render_id, viewer))


@router.get("/{render_id}/files", response_class=Response)
async def download(
    render_id: uuid.UUID,
    session: SessionDep,
    store: StoreDep,
    caller: DownloadDep,
) -> Response:
    found = await render_service.download(
        session, render_id, store, str(caller.user_id)
    )
    return Response(
        content=found.payload,
        media_type=render_service.CONTENT_TYPE,
        headers={
            "Content-Disposition": _disposition(render_id, found.filename)
        },
    )


def _disposition(render_id: uuid.UUID, filename: str) -> str:
    """ASCII 回落名在前、RFC 5987 的 UTF-8 名在后：老客户端仍拿得到文件。

    Args: render_id, filename。
    """
    fallback = f"report-{render_id}.docx"
    return (
        f'attachment; filename="{fallback}"; '
        f"filename*=UTF-8''{quote(filename, safe='')}"
    )


@router.get("/runtime/settings", response_model=ApiResponse[ReportRuntimeOut])
async def runtime(
    container: ContainerDep, _viewer: ViewDep
) -> ApiResponse[ReportRuntimeOut]:
    return ok(
        ReportRuntimeOut(
            is_schedule_enabled=container.settings.report_schedule_enabled,
            timezone=container.settings.dataset_bucket_timezone,
            api_connections=[
                ReportApiConnectionOut(code=item.code, name=item.name)
                for item in container.settings.report_connections
            ],
        )
    )
