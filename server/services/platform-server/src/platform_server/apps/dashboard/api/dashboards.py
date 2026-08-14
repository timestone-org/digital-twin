"""大屏面。

读用 `dashboard:view`，建删用 `dashboard:manage`，改内容用 `dashboard:edit`。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.dashboard.catalog import DASHBOARD_VIEW
from platform_server.apps.dashboard.deps import (
    WriteContext,
    get_edit_context,
    get_manage_context,
    get_session,
    get_validation_context,
    require,
)
from platform_server.apps.dashboard.schemas import (
    DashboardCreateIn,
    DashboardOut,
    DashboardSummaryOut,
    DashboardUpdateIn,
    ReplaceLayoutIn,
    ValidationReportOut,
)
from platform_server.apps.dashboard.services import (
    ValidationContext,
    dashboard_service,
    layout_service,
)
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/dashboards", tags=["dashboard"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContextDep = Annotated[ValidationContext, Depends(get_validation_context)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(DASHBOARD_VIEW))]
EditDep = Annotated[WriteContext, Depends(get_edit_context)]
ManageDep = Annotated[WriteContext, Depends(get_manage_context)]


@router.get(
    "",
    response_model=ApiResponse[Page[DashboardSummaryOut]],
    summary="大屏列表",
)
async def list_dashboards(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    project_id: uuid.UUID | None = None,
    q: str | None = None,
    sort: str | None = None,
) -> ApiResponse[Page[DashboardSummaryOut]]:
    """分页列出大屏，不带节点树。

    Args: session, page, _viewer, project_id, q, sort。
    """
    return ok(
        await dashboard_service.list_dashboards(
            session, project_id=project_id, keyword=q, page=page, sort=sort
        )
    )


@router.post(
    "",
    response_model=ApiResponse[DashboardOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建大屏",
)
async def create_dashboard(
    payload: DashboardCreateIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[DashboardOut]:
    """建大屏。支持 `Idempotency-Key`。

    Args: payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_dashboard",
        model=DashboardOut,
        action=lambda: dashboard_service.create_dashboard(
            session, payload=payload
        ),
    )
    response.headers["Location"] = f"{API_PREFIX}/dashboards/{created.id}"
    return ok(created, message="大屏已创建")


@router.get(
    "/{dashboard_id}",
    response_model=ApiResponse[DashboardOut],
    summary="加载大屏",
)
async def read_dashboard(
    dashboard_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[DashboardOut]:
    """加载一张大屏，运行时与编辑器共用。

    Args: dashboard_id, session, _viewer。
    """
    return ok(await dashboard_service.get_dashboard(session, dashboard_id))


@router.patch(
    "/{dashboard_id}",
    response_model=ApiResponse[DashboardOut],
    summary="更新大屏元数据",
)
async def update_dashboard(
    dashboard_id: uuid.UUID,
    payload: DashboardUpdateIn,
    session: SessionDep,
    _write: EditDep,
) -> ApiResponse[DashboardOut]:
    """改大屏元数据。

    Args: dashboard_id, payload, session, _write。
    """
    updated = await dashboard_service.update_dashboard(
        session, dashboard_id=dashboard_id, payload=payload
    )
    return ok(updated, message="大屏已更新")


@router.delete(
    "/{dashboard_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除大屏",
)
async def delete_dashboard(
    dashboard_id: uuid.UUID, session: SessionDep, _write: ManageDep
) -> Response:
    """删大屏，节点与绑定一并消失。

    Args: dashboard_id, session, _write。
    """
    await dashboard_service.delete_dashboard(session, dashboard_id=dashboard_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{dashboard_id}:replace-layout",
    response_model=ApiResponse[DashboardOut],
    summary="整树替换",
)
async def replace_layout(
    dashboard_id: uuid.UUID,
    payload: ReplaceLayoutIn,
    session: SessionDep,
    write: EditDep,
) -> ApiResponse[DashboardOut]:
    """整棵树替换，必带 `expected_version`。

    Args: dashboard_id, payload, session, write。
    """
    saved = await layout_service.replace_layout(
        session,
        dashboard_id=dashboard_id,
        payload=payload,
        context=write.validation,
    )
    return ok(saved, message="布局已保存")


@router.post(
    "/{dashboard_id}:validate",
    response_model=ApiResponse[ValidationReportOut],
    summary="大屏自检",
)
async def validate_dashboard(
    dashboard_id: uuid.UUID,
    session: SessionDep,
    context: ContextDep,
    _viewer: ViewDep,
) -> ApiResponse[ValidationReportOut]:
    """列出这张大屏上全部悬空引用，不改任何东西。

    Args: dashboard_id, session, context, _viewer。
    """
    return ok(
        await dashboard_service.validate_dashboard(
            session, dashboard_id=dashboard_id, context=context
        )
    )
