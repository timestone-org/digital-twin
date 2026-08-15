"""地址空间节点数据访问。"""

import uuid
from collections.abc import Collection

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from opcua_server.apps.instance.models import Node

SORTABLE = {
    "browse_name": Node.browse_name,
    "identifier": Node.identifier,
    "created_at": Node.created_at,
}
DEFAULT_ORDER = (Node.browse_name.asc(),)


class NodeCrud(CrudBase[Node]):
    """`opcua_nodes` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(Node)

    async def get_by_identifier(
        self, session: AsyncSession, *, instance_id: uuid.UUID, identifier: str
    ) -> Node | None:
        """按实例内的标识取节点。

        Args: session, instance_id, identifier。
        """
        result = await session.execute(
            select(Node).where(
                Node.instance_id == instance_id,
                Node.identifier == identifier,
            )
        )
        return result.scalars().one_or_none()

    async def list_by_ids(
        self,
        session: AsyncSession,
        *,
        instance_id: uuid.UUID,
        ids: Collection[uuid.UUID],
    ) -> list[Node]:
        """按行 id 批量取同一实例下的节点。

        ⚠ 结果**可能比入参少**：问到的 id 里有已删除的、或属于别的实例的。
        调用方按 id 自己对齐，不许按下标对齐。

        Args: session, instance_id, ids。
        """
        if not ids:
            return []
        result = await session.execute(
            select(Node).where(
                Node.instance_id == instance_id, Node.id.in_(ids)
            )
        )
        return list(result.scalars().all())

    async def list_of_instance(
        self, session: AsyncSession, instance_id: uuid.UUID
    ) -> list[Node]:
        """取某实例的全部节点，供启动时一次性建出地址空间。

        ⚠ 建树要一次取全：逐个节点各查一次父节点是典型的 N+1，
        而地址空间在实例启动的热路径上。

        Args: session, instance_id。
        """
        result = await session.execute(
            select(Node)
            .where(Node.instance_id == instance_id)
            .order_by(Node.created_at.asc())
        )
        return list(result.scalars().all())

    async def children_of(
        self, session: AsyncSession, parent_id: uuid.UUID
    ) -> list[Node]:
        """取直接子节点。

        Args: session, parent_id。
        """
        result = await session.execute(
            select(Node)
            .where(Node.parent_id == parent_id)
            .order_by(Node.browse_name.asc())
        )
        return list(result.scalars().all())

    async def count_of_instance(
        self, session: AsyncSession, instance_id: uuid.UUID
    ) -> int:
        """某实例的节点数。

        Args: session, instance_id。
        """
        result = await session.execute(
            select(func.count())
            .select_from(Node)
            .where(Node.instance_id == instance_id)
        )
        return int(result.scalar_one())

    @staticmethod
    def build_query(
        *, instance_id: uuid.UUID, keyword: str | None
    ) -> Select[tuple[Node]]:
        """按实例与关键字构造列表查询。

        Args: instance_id, keyword。
        """
        statement = select(Node).where(Node.instance_id == instance_id)
        if keyword:
            pattern = f"%{keyword.lower()}%"
            statement = statement.where(
                func.lower(Node.browse_name).like(pattern)
            )
        return statement


node_crud = NodeCrud()
