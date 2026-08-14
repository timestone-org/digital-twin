"""项目数据访问。"""

import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.dashboard.models import Dashboard, DashboardProject

SORTABLE = {
    "name": DashboardProject.name,
    "created_at": DashboardProject.created_at,
}
DEFAULT_ORDER = (DashboardProject.name.asc(), DashboardProject.id.asc())


class ProjectCrud(CrudBase[DashboardProject]):
    """`dashboard_projects` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(DashboardProject)

    async def dashboard_counts(
        self, session: AsyncSession, project_ids: frozenset[uuid.UUID]
    ) -> dict[uuid.UUID, int]:
        """批量取每个项目下的大屏数，避免列表页 N+1。

        Args: session, project_ids。
        """
        if not project_ids:
            return {}
        rows = await session.execute(
            select(Dashboard.project_id, func.count())
            .where(Dashboard.project_id.in_(project_ids))
            .group_by(Dashboard.project_id)
        )
        counts = dict.fromkeys(project_ids, 0)
        for project_id, total in rows.all():
            counts[project_id] = int(total)
        return counts

    @staticmethod
    def build_query(*, keyword: str | None) -> Select[tuple[DashboardProject]]:
        """按关键字构造列表查询。

        Args: keyword。
        """
        statement = select(DashboardProject)
        if keyword:
            pattern = f"%{keyword.lower()}%"
            statement = statement.where(
                func.lower(DashboardProject.name).like(pattern)
            )
        return statement


project_crud = ProjectCrud()
