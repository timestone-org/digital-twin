"""项目管理面。事务边界在这一层：crud 不提交，api 不写业务。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.web import Page, PageParams
from platform_server.apps.dashboard.crud import dashboard_crud, project_crud
from platform_server.apps.dashboard.crud.project import (
    DEFAULT_ORDER,
    SORTABLE,
)
from platform_server.apps.dashboard.errors import (
    ProjectNotEmpty,
    ProjectNotFound,
)
from platform_server.apps.dashboard.models import DashboardProject
from platform_server.apps.dashboard.schemas import (
    ProjectCreateIn,
    ProjectOut,
    ProjectUpdateIn,
)
from platform_server.apps.dashboard.services.changes import given_changes
from platform_server.apps.dashboard.services.presenters import to_project_out

_logger = get_logger("platform.dashboard.project")


async def list_projects(
    session: AsyncSession,
    *,
    keyword: str | None,
    page: PageParams,
    sort: str | None,
) -> Page[ProjectOut]:
    """项目列表。大屏计数批量查，不逐行发查询。

    Args: session, keyword, page, sort。
    """
    statement = project_crud.order_by_whitelist(
        project_crud.build_query(keyword=keyword),
        sort=sort,
        allowed=dict(SORTABLE),
        default=DEFAULT_ORDER,
    )
    rows, total = await project_crud.list_page(
        session, statement=statement, offset=page.offset, limit=page.size
    )
    counts = await project_crud.dashboard_counts(
        session, frozenset(row.id for row in rows)
    )
    return Page[ProjectOut](
        items=[
            to_project_out(row, dashboard_count=counts.get(row.id, 0))
            for row in rows
        ],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_project(
    session: AsyncSession, project_id: uuid.UUID
) -> ProjectOut:
    """项目详情。

    Args: session, project_id。
    """
    project = await require_project(session, project_id)
    return await _present(session, project)


async def create_project(
    session: AsyncSession, *, payload: ProjectCreateIn
) -> ProjectOut:
    """建项目。

    Args: session, payload。
    """
    project = DashboardProject(
        name=payload.name,
        description=payload.description,
        theme_json=payload.theme_json,
        brand_json=payload.brand_json,
    )
    project_crud.add(session, project)
    await session.flush()
    _logger.info("project_created", "项目已创建", project_id=str(project.id))
    return await _present(session, project)


async def update_project(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    payload: ProjectUpdateIn,
) -> ProjectOut:
    """改项目。缺省的字段不动。

    Args: session, project_id, payload。
    """
    project = await require_project(session, project_id)
    project_crud.apply_changes(project, given_changes(payload))
    await session.flush()
    _logger.info("project_updated", "项目已更新", project_id=str(project.id))
    return await _present(session, project)


async def delete_project(
    session: AsyncSession, *, project_id: uuid.UUID
) -> None:
    """删项目。下面还有大屏时拒绝——级联删会连着整棵节点树一起消失。

    Args: session, project_id。
    """
    project = await require_project(session, project_id)
    if await dashboard_crud.count_by_project(session, project.id) > 0:
        raise ProjectNotEmpty("该项目下还有大屏，请先删除大屏")
    _logger.info("project_deleted", "项目已删除", project_id=str(project.id))
    await project_crud.delete(session, project)


async def require_project(
    session: AsyncSession, project_id: uuid.UUID
) -> DashboardProject:
    """取项目，取不到即 404。

    Args: session, project_id。
    """
    project = await project_crud.get(session, project_id)
    if project is None:
        raise ProjectNotFound("项目不存在")
    return project


async def _present(
    session: AsyncSession, project: DashboardProject
) -> ProjectOut:
    counts = await project_crud.dashboard_counts(
        session, frozenset({project.id})
    )
    return to_project_out(project, dashboard_count=counts.get(project.id, 0))
