"""项目自定义主题的增删改查。读用 `dashboard:view`，写用 `dashboard:edit`。

⚠ 前缀是 `dashboard-projects` 而不是 `projects`：项目资源本身就挂在那里，
而边缘的路由规则按 `platform/dashboard*` 分档。挂到 `projects` 上会掉进按
方法兜底的那几条去要 `ac:*` 的码，表现是「有大屏权限的人改不了主题」。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
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
from platform_server.apps.dashboard.schemas.theme import (
    ThemeCreateIn,
    ThemeOut,
    ThemeUpdateIn,
)
from platform_server.apps.dashboard.services import theme_service
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/dashboard-projects", tags=["dashboard-project"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(DASHBOARD_VIEW))]
EditDep = Annotated[WriteContext, Depends(get_edit_context)]


@router.get(
    "/{project_id}/themes",
    response_model=ApiResponse[list[ThemeOut]],
    summary="项目自定义主题列表",
)
async def list_themes(
    project_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[list[ThemeOut]]:
    """列出项目下全部自定义主题。

    Args: project_id, session, _viewer。
    """
    return ok(await theme_service.list_themes(session, project_id=project_id))


@router.post(
    "/{project_id}/themes",
    response_model=ApiResponse[ThemeOut],
    status_code=status.HTTP_201_CREATED,
    summary="新建项目自定义主题",
)
async def create_theme(
    project_id: uuid.UUID,
    payload: ThemeCreateIn,
    session: SessionDep,
    write: EditDep,
) -> ApiResponse[ThemeOut]:
    """新建一套自定义主题。支持 `Idempotency-Key`。

    Args: project_id, payload, session, write。
    """
    created = await write.run_once(
        endpoint="create_project_theme",
        model=ThemeOut,
        action=lambda: theme_service.create_theme(
            session, project_id=project_id, payload=payload
        ),
    )
    return ok(created, message="主题已创建")


@router.patch(
    "/{project_id}/themes/{theme_id}",
    response_model=ApiResponse[ThemeOut],
    summary="更新项目自定义主题",
)
async def update_theme(
    project_id: uuid.UUID,
    theme_id: uuid.UUID,
    payload: ThemeUpdateIn,
    session: SessionDep,
    _write: EditDep,
) -> ApiResponse[ThemeOut]:
    """改一套自定义主题。缺省的字段不动。

    Args: project_id, theme_id, payload, session, _write。
    """
    updated = await theme_service.update_theme(
        session, project_id=project_id, theme_id=theme_id, payload=payload
    )
    return ok(updated, message="主题已更新")


@router.delete(
    "/{project_id}/themes/{theme_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除项目自定义主题",
)
async def delete_theme(
    project_id: uuid.UUID,
    theme_id: uuid.UUID,
    session: SessionDep,
    _write: EditDep,
) -> Response:
    """删一套自定义主题。引用它的大屏照常渲染，回退到默认配色。

    Args: project_id, theme_id, session, _write。
    """
    await theme_service.delete_theme(
        session, project_id=project_id, theme_id=theme_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
