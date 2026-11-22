"""数据源数据访问。"""

import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.collect.models import CollectPoint, CollectSource

SORTABLE = {
    "code": CollectSource.code,
    "name": CollectSource.name,
    "created_at": CollectSource.created_at,
}
DEFAULT_ORDER = (CollectSource.code.asc(), CollectSource.id.asc())


class SourceCrud(CrudBase[CollectSource]):
    """`collect_sources` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(CollectSource)

    async def get_for_update(
        self, session: AsyncSession, source_id: uuid.UUID
    ) -> CollectSource | None:
        """读取最新来源配置并锁定该行。Args: session, source_id。"""
        return await session.get(
            CollectSource,
            source_id,
            with_for_update=True,
            populate_existing=True,
        )

    async def get_by_code(
        self, session: AsyncSession, code: str
    ) -> CollectSource | None:
        """按编码取一行。

        Args: session, code。
        """
        rows = await session.execute(
            select(CollectSource).where(CollectSource.code == code)
        )
        return rows.scalars().first()

    async def list_all(
        self, session: AsyncSession, *, is_enabled: bool | None = None
    ) -> list[CollectSource]:
        """按列表顺序读取数据源，可按启用状态过滤。

        Args: session, is_enabled。
        """
        query = self.build_query(
            keyword=None, protocol=None, is_enabled=is_enabled
        )
        rows = await session.execute(query.order_by(*DEFAULT_ORDER))
        return list(rows.scalars().all())

    async def point_counts(
        self, session: AsyncSession, source_ids: frozenset[uuid.UUID]
    ) -> dict[uuid.UUID, int]:
        """批量取每个数据源下的点位数，避免列表页 N+1。

        Args: session, source_ids。
        """
        if not source_ids:
            return {}
        rows = await session.execute(
            select(CollectPoint.source_id, func.count())
            .where(CollectPoint.source_id.in_(source_ids))
            .group_by(CollectPoint.source_id)
        )
        counts = dict.fromkeys(source_ids, 0)
        for source_id, total in rows.all():
            counts[source_id] = int(total)
        return counts

    @staticmethod
    def build_query(
        *, keyword: str | None, protocol: str | None, is_enabled: bool | None
    ) -> Select[tuple[CollectSource]]:
        """按过滤条件构造列表查询。

        Args: keyword, protocol, is_enabled。
        """
        statement = select(CollectSource)
        if keyword:
            statement = statement.where(
                CollectSource.name.icontains(keyword, autoescape=True)
                | CollectSource.code.icontains(keyword, autoescape=True)
            )
        if protocol is not None:
            statement = statement.where(CollectSource.protocol == protocol)
        if is_enabled is not None:
            statement = statement.where(CollectSource.is_enabled == is_enabled)
        return statement


source_crud = SourceCrud()
