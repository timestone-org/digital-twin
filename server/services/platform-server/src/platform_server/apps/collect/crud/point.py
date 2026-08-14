"""点位数据访问。"""

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.collect.models import CollectPoint

SORTABLE = {
    "code": CollectPoint.code,
    "name": CollectPoint.name,
    "created_at": CollectPoint.created_at,
}
# ⚠ 写死排序：没有它，两次列出同一个数据源的点位不保证同序，Agent 就无法靠
# diff 判断自己这一步改了什么（ADR-0012 决策三同理）
DEFAULT_ORDER = (
    CollectPoint.source_id.asc(),
    CollectPoint.code.asc(),
    CollectPoint.id.asc(),
)


class PointCrud(CrudBase[CollectPoint]):
    """`collect_points` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(CollectPoint)

    async def list_all(self, session: AsyncSession) -> list[CollectPoint]:
        """取全部点位，顺序写死。

        Args: session。
        """
        rows = await session.execute(
            select(CollectPoint).order_by(*DEFAULT_ORDER)
        )
        return list(rows.scalars().all())

    async def taken_codes(
        self, session: AsyncSession, source_id: uuid.UUID, codes: Sequence[str]
    ) -> frozenset[str]:
        """这些编码里哪些已经被该数据源占了。

        Args: session, source_id, codes。
        """
        if not codes:
            return frozenset()
        rows = await session.execute(
            select(CollectPoint.code).where(
                CollectPoint.source_id == source_id,
                CollectPoint.code.in_(list(codes)),
            )
        )
        return frozenset(rows.scalars().all())

    async def count_by_source(
        self, session: AsyncSession, source_id: uuid.UUID
    ) -> int:
        """一个数据源下有多少点位。

        Args: session, source_id。
        """
        rows = await session.execute(
            select(func.count())
            .select_from(CollectPoint)
            .where(CollectPoint.source_id == source_id)
        )
        return int(rows.scalar_one())

    @staticmethod
    def build_query(
        *, source_id: uuid.UUID | None, keyword: str | None
    ) -> Select[tuple[CollectPoint]]:
        """按过滤条件构造列表查询。

        Args: source_id, keyword（Agent 按名字找点用）。
        """
        statement = select(CollectPoint)
        if source_id is not None:
            statement = statement.where(CollectPoint.source_id == source_id)
        if keyword:
            pattern = f"%{keyword.lower()}%"
            statement = statement.where(
                func.lower(CollectPoint.name).like(pattern)
                | func.lower(CollectPoint.code).like(pattern)
            )
        return statement


point_crud = PointCrud()
