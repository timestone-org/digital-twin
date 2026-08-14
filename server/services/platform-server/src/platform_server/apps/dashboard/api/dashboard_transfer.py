"""大屏的复制、导出与导入。

复制与导入建资源，走 `dashboard:manage` 并支持 `Idempotency-Key`；导出只读，
走 `dashboard:view`。
"""

import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.dashboard.catalog import DASHBOARD_VIEW
from platform_server.apps.dashboard.deps import (
    WriteContext,
    get_manage_context,
    get_session,
    require,
)
from platform_server.apps.dashboard.schemas import DashboardOut
from platform_server.apps.dashboard.schemas.transfer import (
    DashboardExportOut,
    DashboardImportIn,
    DashboardImportOut,
    DuplicateDashboardIn,
)
from platform_server.apps.dashboard.services import transfer_service
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=API_PREFIX, tags=["dashboard"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(DASHBOARD_VIEW))]
ManageDep = Annotated[WriteContext, Depends(get_manage_context)]


def copy_action(
    session: AsyncSession,
    write: WriteContext,
    dashboard_id: uuid.UUID,
    payload: DuplicateDashboardIn,
) -> Callable[[], Awaitable[DashboardOut]]:
    """把这一次复制包成一个动作，交给幂等闸只跑一遍。

    Args: session, write, dashboard_id, payload。
    """
    return lambda: transfer_service.duplicate_dashboard(
        session,
        dashboard_id=dashboard_id,
        payload=payload,
        context=write.validation,
    )


@router.post(
    "/dashboards/{dashboard_id}:duplicate",
    response_model=ApiResponse[DashboardOut],
    status_code=status.HTTP_201_CREATED,
    summary="复制大屏",
)
async def duplicate_dashboard(
    dashboard_id: uuid.UUID,
    payload: DuplicateDashboardIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[DashboardOut]:
    """复制一张大屏。支持 `Idempotency-Key`。

    Args: dashboard_id, payload, session, response, write。
    """
    copied = await write.run_once(
        endpoint="duplicate_dashboard",
        model=DashboardOut,
        action=copy_action(session, write, dashboard_id, payload),
    )
    response.headers["Location"] = f"{API_PREFIX}/dashboards/{copied.id}"
    return ok(copied, message="大屏已复制")


@router.post(
    "/dashboards/{dashboard_id}:export",
    response_model=ApiResponse[DashboardExportOut],
    summary="导出大屏",
)
async def export_dashboard(
    dashboard_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[DashboardExportOut]:
    """导出一张大屏成可移植文档，不改任何东西。

    Args: dashboard_id, session, _viewer。
    """
    return ok(
        await transfer_service.export_dashboard(
            session, dashboard_id=dashboard_id
        )
    )


@router.post(
    "/dashboards:import",
    response_model=ApiResponse[DashboardImportOut],
    summary="导入大屏",
)
async def import_dashboard(
    payload: DashboardImportIn, session: SessionDep, write: ManageDep
) -> ApiResponse[DashboardImportOut]:
    """导入一份文档。支持 `Idempotency-Key`。

    Args: payload, session, write。
    """
    imported = await write.run_once(
        endpoint="import_dashboard",
        model=DashboardImportOut,
        action=lambda: transfer_service.import_dashboard(
            session,
            project_id=payload.project_id,
            payload=payload.payload,
            context=write.validation,
            new_name=payload.new_name,
            target_dashboard_id=payload.target_dashboard_id,
        ),
    )
    return ok(imported, message="大屏已导入")
