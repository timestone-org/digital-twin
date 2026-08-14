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

    async def list_all(self, session: AsyncSession) -> list[CollectSource]:
        """取全部数据源，顺序与列表页一致。计划下发用它。

        Args: session。
        """
        rows = await session.execute(
            select(CollectSource).order_by(*DEFAULT_ORDER)
        )
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
            pattern = f"%{keyword.lower()}%"
            statement = statement.where(
                func.lower(CollectSource.name).like(pattern)
                | func.lower(CollectSource.code).like(pattern)
            )
        if protocol is not None:
            statement = statement.where(CollectSource.protocol == protocol)
        if is_enabled is not None:
            statement = statement.where(CollectSource.is_enabled == is_enabled)
        return statement


source_crud = SourceCrud()
