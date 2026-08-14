"""项目面。读用 `dashboard:view`，增删改用 `dashboard:manage`。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.dashboard.catalog import DASHBOARD_VIEW
from platform_server.apps.dashboard.deps import (
    WriteContext,
    get_manage_context,
    get_session,
    require,
)
from platform_server.apps.dashboard.schemas import (
    ProjectCreateIn,
    ProjectOut,
    ProjectUpdateIn,
)
from platform_server.apps.dashboard.services import project_service
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/dashboard-projects", tags=["dashboard-project"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(DASHBOARD_VIEW))]
ManageDep = Annotated[WriteContext, Depends(get_manage_context)]


@router.get(
    "", response_model=ApiResponse[Page[ProjectOut]], summary="项目列表"
)
async def list_projects(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    q: str | None = None,
    sort: str | None = None,
) -> ApiResponse[Page[ProjectOut]]:
    """分页列出项目。

    Args: session, page, _viewer, q, sort。
    """
    return ok(
        await project_service.list_projects(
            session, keyword=q, page=page, sort=sort
        )
    )


@router.post(
    "",
    response_model=ApiResponse[ProjectOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建项目",
)
async def create_project(
    payload: ProjectCreateIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[ProjectOut]:
    """建项目。支持 `Idempotency-Key`。

    Args: payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_dashboard_project",
        model=ProjectOut,
        action=lambda: project_service.create_project(session, payload=payload),
    )
    response.headers["Location"] = (
        f"{API_PREFIX}/dashboard-projects/{created.id}"
    )
    return ok(created, message="项目已创建")


@router.get(
    "/{project_id}",
    response_model=ApiResponse[ProjectOut],
    summary="项目详情",
)
async def read_project(
    project_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[ProjectOut]:
    """项目详情。

    Args: project_id, session, _viewer。
    """
    return ok(await project_service.get_project(session, project_id))


@router.patch(
    "/{project_id}",
    response_model=ApiResponse[ProjectOut],
    summary="更新项目",
)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdateIn,
    session: SessionDep,
    _write: ManageDep,
) -> ApiResponse[ProjectOut]:
    """改项目。

    Args: project_id, payload, session, _write。
    """
    updated = await project_service.update_project(
        session, project_id=project_id, payload=payload
    )
    return ok(updated, message="项目已更新")


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除项目",
)
async def delete_project(
    project_id: uuid.UUID, session: SessionDep, _write: ManageDep
) -> Response:
    """删项目。下面还有大屏时先删大屏。

    Args: project_id, session, _write。
    """
    await project_service.delete_project(session, project_id=project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
