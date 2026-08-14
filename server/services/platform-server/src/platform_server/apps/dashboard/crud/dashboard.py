"""大屏数据访问。"""

import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.dashboard.models import Dashboard, DashboardNode

SORTABLE = {
    "name": Dashboard.name,
    "created_at": Dashboard.created_at,
    "updated_at": Dashboard.updated_at,
}
DEFAULT_ORDER = (Dashboard.name.asc(), Dashboard.id.asc())


class DashboardCrud(CrudBase[Dashboard]):
    """`dashboards` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(Dashboard)

    async def node_counts(
        self, session: AsyncSession, dashboard_ids: frozenset[uuid.UUID]
    ) -> dict[uuid.UUID, int]:
        """批量取每张大屏的节点数。

        Args: session, dashboard_ids。
        """
        if not dashboard_ids:
            return {}
        rows = await session.execute(
            select(DashboardNode.dashboard_id, func.count())
            .where(DashboardNode.dashboard_id.in_(dashboard_ids))
            .group_by(DashboardNode.dashboard_id)
        )
        counts = dict.fromkeys(dashboard_ids, 0)
        for dashboard_id, total in rows.all():
            counts[dashboard_id] = int(total)
        return counts

    async def count_by_project(
        self, session: AsyncSession, project_id: uuid.UUID
    ) -> int:
        """一个项目下有几张大屏。

        Args: session, project_id。
        """
        return await self.count(
            session,
            statement=select(Dashboard).where(
                Dashboard.project_id == project_id
            ),
        )

    @staticmethod
    def build_query(
        *, project_id: uuid.UUID | None, keyword: str | None
    ) -> Select[tuple[Dashboard]]:
        """按项目与关键字构造列表查询。

        Args: project_id, keyword。
        """
        statement = select(Dashboard)
        if project_id is not None:
            statement = statement.where(Dashboard.project_id == project_id)
        if keyword:
            pattern = f"%{keyword.lower()}%"
            statement = statement.where(
                func.lower(Dashboard.name).like(pattern)
            )
        return statement


dashboard_crud = DashboardCrud()
