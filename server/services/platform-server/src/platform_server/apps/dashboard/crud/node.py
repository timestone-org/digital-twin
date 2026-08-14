"""画布节点数据访问。

⚠ 顺序钉死在查询里：关系上没有 `order_by` 时，两次导出同一张未修改的大屏
不保证逐字节相同，Agent 就无法靠 diff 判断自己这一步改了什么（ADR-0012 三）。
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.dashboard.models import DashboardNode

# ⚠ `nulls_first`：Postgres 的升序默认 NULLS LAST，顶层节点（parent_id 为空）
# 会排到全部子节点后面——顺序仍然确定，但读出来的树是倒着的
NODE_ORDER = (
    DashboardNode.parent_id.asc().nulls_first(),
    DashboardNode.z_index.asc(),
    DashboardNode.id.asc(),
)


class NodeCrud(CrudBase[DashboardNode]):
    """`dashboard_nodes` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(DashboardNode)

    async def list_by_dashboard(
        self, session: AsyncSession, dashboard_id: uuid.UUID
    ) -> list[DashboardNode]:
        """一张大屏的全部节点，按 `(parent_id, z_index, id)`。

        Args: session, dashboard_id。
        """
        rows = await session.execute(
            self.build_query(dashboard_id=dashboard_id).order_by(*NODE_ORDER)
        )
        return list(rows.scalars().all())

    async def delete_by_ids(
        self, session: AsyncSession, node_ids: Sequence[uuid.UUID]
    ) -> None:
        """按 id 批量删除；子树由数据库的级联外键带走。

        Args: session, node_ids。
        """
        if not node_ids:
            return
        await session.execute(
            delete(DashboardNode).where(DashboardNode.id.in_(node_ids))
        )

    @staticmethod
    def build_query(*, dashboard_id: uuid.UUID) -> Select[tuple[DashboardNode]]:
        """按大屏过滤的列表查询。

        Args: dashboard_id。
        """
        return select(DashboardNode).where(
            DashboardNode.dashboard_id == dashboard_id
        )


node_crud = NodeCrud()
