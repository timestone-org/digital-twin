"""大屏管理面：元数据、加载与自检。节点树的写入见 node/binding/layout。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.web import Page, PageParams
from platform_server.apps.dashboard.crud import dashboard_crud
from platform_server.apps.dashboard.crud.dashboard import (
    DEFAULT_ORDER,
    SORTABLE,
)
from platform_server.apps.dashboard.errors import (
    DashboardNotFound,
    VersionConflict,
)
from platform_server.apps.dashboard.models import Dashboard
from platform_server.apps.dashboard.schemas import (
    DashboardCreateIn,
    DashboardOut,
    DashboardSummaryOut,
    DashboardUpdateIn,
    LayoutIssueOut,
    ValidationReportOut,
)
from platform_server.apps.dashboard.services.changes import given_changes
from platform_server.apps.dashboard.services.presenters import (
    to_dashboard_out,
    to_dashboard_summary_out,
    to_node_out,
)
from platform_server.apps.dashboard.services.project_service import (
    require_project,
)
from platform_server.apps.dashboard.services.state import (
    binding_drafts,
    load_state,
    node_drafts,
)
from platform_server.apps.dashboard.services.validation import (
    ValidationContext,
    collect_issues,
)

_logger = get_logger("platform.dashboard.dashboard")


async def list_dashboards(
    session: AsyncSession,
    *,
    project_id: uuid.UUID | None,
    keyword: str | None,
    page: PageParams,
    sort: str | None,
) -> Page[DashboardSummaryOut]:
    """大屏列表。不带节点树——列表页拉整棵树是纯浪费。

    Args: session, project_id, keyword, page, sort。
    """
    statement = dashboard_crud.order_by_whitelist(
        dashboard_crud.build_query(project_id=project_id, keyword=keyword),
        sort=sort,
        allowed=dict(SORTABLE),
        default=DEFAULT_ORDER,
    )
    rows, total = await dashboard_crud.list_page(
        session, statement=statement, offset=page.offset, limit=page.size
    )
    counts = await dashboard_crud.node_counts(
        session, frozenset(row.id for row in rows)
    )
    return Page[DashboardSummaryOut](
        items=[
            to_dashboard_summary_out(row, node_count=counts.get(row.id, 0))
            for row in rows
        ],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_dashboard(
    session: AsyncSession, dashboard_id: uuid.UUID
) -> DashboardOut:
    """加载一张大屏，运行时与编辑器共用同一份。

    Args: session, dashboard_id。
    """
    dashboard = await require_dashboard(session, dashboard_id)
    return await present_dashboard(session, dashboard)


async def create_dashboard(
    session: AsyncSession, *, payload: DashboardCreateIn
) -> DashboardOut:
    """建大屏。项目不存在即 404。

    Args: session, payload。
    """
    project = await require_project(session, payload.project_id)
    dashboard = Dashboard(
        project_id=project.id,
        name=payload.name,
        description=payload.description,
        design_width=payload.design_width,
        design_height=payload.design_height,
        theme_json=payload.theme_json,
        chrome_json=payload.chrome_json,
    )
    dashboard_crud.add(session, dashboard)
    await session.flush()
    _logger.info(
        "dashboard_created", "大屏已创建", dashboard_id=str(dashboard.id)
    )
    return await present_dashboard(session, dashboard)


async def update_dashboard(
    session: AsyncSession,
    *,
    dashboard_id: uuid.UUID,
    payload: DashboardUpdateIn,
) -> DashboardOut:
    """改大屏元数据。节点树不走这里。

    Args: session, dashboard_id, payload。
    """
    dashboard = await require_dashboard(session, dashboard_id)
    dashboard_crud.apply_changes(dashboard, given_changes(payload))
    bump_version(dashboard)
    await session.flush()
    _logger.info(
        "dashboard_updated", "大屏已更新", dashboard_id=str(dashboard.id)
    )
    return await present_dashboard(session, dashboard)


async def delete_dashboard(
    session: AsyncSession, *, dashboard_id: uuid.UUID
) -> None:
    """删大屏，节点与绑定随级联外键一起走。

    Args: session, dashboard_id。
    """
    dashboard = await require_dashboard(session, dashboard_id)
    _logger.info(
        "dashboard_deleted", "大屏已删除", dashboard_id=str(dashboard.id)
    )
    await dashboard_crud.delete(session, dashboard)


async def validate_dashboard(
    session: AsyncSession,
    *,
    dashboard_id: uuid.UUID,
    context: ValidationContext,
) -> ValidationReportOut:
    """自检：把已落库的状态过一遍同一套校验，列出全部悬空引用。

    Args: session, dashboard_id, context。
    """
    dashboard = await require_dashboard(session, dashboard_id)
    state = await load_state(session, dashboard.id)
    issues = await collect_issues(
        nodes=node_drafts(state.nodes),
        bindings=binding_drafts(state.bindings),
        context=context,
    )
    return ValidationReportOut(
        dashboard_id=dashboard.id,
        is_valid=not issues,
        issues=[
            LayoutIssueOut(
                field=issue.field, code=issue.code, message=issue.message
            )
            for issue in issues
        ],
    )


async def require_dashboard(
    session: AsyncSession, dashboard_id: uuid.UUID
) -> Dashboard:
    """取大屏，取不到即 404。本模块内其它 service 也用它。

    Args: session, dashboard_id。
    """
    dashboard = await dashboard_crud.get(session, dashboard_id)
    if dashboard is None:
        raise DashboardNotFound("大屏不存在")
    return dashboard


def require_version(dashboard: Dashboard, expected_version: int) -> None:
    """版本断言。不符即 409，不再是无条件覆盖。

    Args: dashboard, expected_version。
    """
    if dashboard.row_version != expected_version:
        raise VersionConflict("大屏已被其他人改过，请重新加载后再保存")


def bump_version(dashboard: Dashboard) -> None:
    """任何一次结构变更都推进行版本，`expected_version` 才有意义。

    Args: dashboard。
    """
    dashboard.row_version += 1


async def present_dashboard(
    session: AsyncSession, dashboard: Dashboard
) -> DashboardOut:
    """把一张大屏连同它的节点树装成对外形态。

    Args: session, dashboard。
    """
    state = await load_state(session, dashboard.id)
    return to_dashboard_out(
        dashboard,
        nodes=[
            to_node_out(node, bindings=state.bindings_of(node.id))
            for node in state.nodes
        ],
    )
