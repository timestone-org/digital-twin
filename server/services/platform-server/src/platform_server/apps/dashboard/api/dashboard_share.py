"""大屏的发布与取消发布：一次发布换一个公开令牌。

两条都归 `dashboard:manage`——公开一张屏是把它交给全互联网，与改一行配置
不是同一类操作。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import ApiResponse, ok
from platform_server.apps.dashboard.deps import (
    WriteContext,
    get_manage_context,
    get_session,
)
from platform_server.apps.dashboard.schemas.share import DashboardShareOut
from platform_server.apps.dashboard.services import share_service
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/dashboards", tags=["dashboard"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ManageDep = Annotated[WriteContext, Depends(get_manage_context)]


@router.post(
    "/{dashboard_id}:publish",
    response_model=ApiResponse[DashboardShareOut],
    summary="发布大屏",
)
async def publish_dashboard(
    dashboard_id: uuid.UUID, session: SessionDep, write: ManageDep
) -> ApiResponse[DashboardShareOut]:
    """发布，并换发一个新的公开令牌。支持 `Idempotency-Key`。

    Args: dashboard_id, session, write。
    """
    published = await write.run_once(
        endpoint="publish_dashboard",
        model=DashboardShareOut,
        action=lambda: share_service.publish_dashboard(
            session, dashboard_id=dashboard_id
        ),
    )
    return ok(published, message="大屏已发布")


@router.post(
    "/{dashboard_id}:unpublish",
    response_model=ApiResponse[DashboardShareOut],
    summary="取消发布大屏",
)
async def unpublish_dashboard(
    dashboard_id: uuid.UUID, session: SessionDep, write: ManageDep
) -> ApiResponse[DashboardShareOut]:
    """撤回公开，公开链接随即失效。支持 `Idempotency-Key`。

    Args: dashboard_id, session, write。
    """
    withdrawn = await write.run_once(
        endpoint="unpublish_dashboard",
        model=DashboardShareOut,
        action=lambda: share_service.unpublish_dashboard(
            session, dashboard_id=dashboard_id
        ),
    )
    return ok(withdrawn, message="大屏已取消发布")
