"""绑定数据访问。顺序钉死在 `(field_key, id)`。"""

import uuid
from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.dashboard.models import (
    DashboardBinding,
    DashboardNode,
)

BINDING_ORDER = (
    DashboardBinding.field_key.asc(),
    DashboardBinding.id.asc(),
)


class BindingCrud(CrudBase[DashboardBinding]):
    """`dashboard_bindings` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(DashboardBinding)

    async def dashboard_id_of(
        self, session: AsyncSession, binding_id: uuid.UUID
    ) -> uuid.UUID | None:
        """绑定所在的大屏，只读这一列，不把绑定载入身份映射。

        Args: session, binding_id。
        """
        rows = await session.execute(
            select(DashboardNode.dashboard_id)
            .join(
                DashboardBinding, DashboardBinding.node_id == DashboardNode.id
            )
            .where(DashboardBinding.id == binding_id)
        )
        return rows.scalar_one_or_none()

    async def list_by_nodes(
        self, session: AsyncSession, node_ids: Sequence[uuid.UUID]
    ) -> list[DashboardBinding]:
        """一批节点的全部绑定，按 `(field_key, id)`。

        Args: session, node_ids。
        """
        if not node_ids:
            return []
        rows = await session.execute(
            select(DashboardBinding)
            .where(DashboardBinding.node_id.in_(node_ids))
            .order_by(*BINDING_ORDER)
        )
        return list(rows.scalars().all())

    async def delete_by_ids(
        self, session: AsyncSession, binding_ids: Sequence[uuid.UUID]
    ) -> None:
        """按 id 批量删除绑定。

        Args: session, binding_ids。
        """
        if not binding_ids:
            return
        await session.execute(
            delete(DashboardBinding).where(DashboardBinding.id.in_(binding_ids))
        )


binding_crud = BindingCrud()
