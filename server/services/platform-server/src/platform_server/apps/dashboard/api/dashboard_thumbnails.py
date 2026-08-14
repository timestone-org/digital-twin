"""大屏缩略图的读写。读用 `dashboard:view`，写用 `dashboard:edit`。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.dashboard.catalog import DASHBOARD_VIEW
from platform_server.apps.dashboard.deps import (
    WriteContext,
    get_edit_context,
    get_session,
    require,
)
from platform_server.apps.dashboard.schemas.thumbnail import (
    ThumbnailOut,
    ThumbnailPutIn,
)
from platform_server.apps.dashboard.services import thumbnail_service
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/dashboards", tags=["dashboard"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(DASHBOARD_VIEW))]
EditDep = Annotated[WriteContext, Depends(get_edit_context)]


@router.get(
    "/{dashboard_id}/thumbnail",
    response_model=ApiResponse[ThumbnailOut],
    summary="大屏缩略图",
)
async def read_thumbnail(
    dashboard_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[ThumbnailOut]:
    """取缩略图。查不到回 404，前端据此显示占位图。

    Args: dashboard_id, session, _viewer。
    """
    return ok(
        await thumbnail_service.get_thumbnail(
            session, dashboard_id=dashboard_id
        )
    )


@router.put(
    "/{dashboard_id}/thumbnail",
    response_model=ApiResponse[ThumbnailOut],
    summary="保存大屏缩略图",
)
async def replace_thumbnail(
    dashboard_id: uuid.UUID,
    payload: ThumbnailPutIn,
    session: SessionDep,
    _write: EditDep,
) -> ApiResponse[ThumbnailOut]:
    """整张替换缩略图。超出体积上限回 413。

    Args: dashboard_id, payload, session, _write。
    """
    stored = await thumbnail_service.put_thumbnail(
        session, dashboard_id=dashboard_id, payload=payload
    )
    return ok(stored, message="缩略图已保存")
