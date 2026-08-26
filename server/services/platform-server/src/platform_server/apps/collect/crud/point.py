"""点位数据访问。"""

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, delete, func, select, tuple_
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

    async def list_by_ids(
        self, session: AsyncSession, point_ids: Sequence[uuid.UUID]
    ) -> list[CollectPoint]:
        """按主键取这一批点位，顺序同列表面。

        Args: session, point_ids。
        """
        if not point_ids:
            return []
        rows = await session.execute(
            select(CollectPoint)
            .where(CollectPoint.id.in_(list(point_ids)))
            .order_by(*DEFAULT_ORDER)
        )
        return list(rows.scalars().all())

    async def delete_many(
        self, session: AsyncSession, point_ids: Sequence[uuid.UUID]
    ) -> None:
        """一条语句删掉这一批。

        ⚠ 不逐条 `session.delete`：那是 N 次往返，而这张表没有 ORM 关系要跟着
        级联，一条 `IN` 删完即可。
        Args: session, point_ids。
        """
        if not point_ids:
            return
        await session.execute(
            delete(CollectPoint).where(CollectPoint.id.in_(list(point_ids)))
        )

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

    async def retention_days_of(
        self,
        session: AsyncSession,
        points: Sequence[tuple[uuid.UUID, str]],
    ) -> list[int | None]:
        """这几个点位各自的归档保留期天数，`None` 表示永久保留。

        ⚠ 点位表里查不到的那几个一行都不回：绑了一个不存在的点位与「那个点位
        永久保留」是两回事，硬凑一个 None 出来会让前者也被当成没有下界。
        Args: session, points（`(source_id, code)` 对）。
        """
        if not points:
            return []
        rows = await session.execute(
            select(CollectPoint.archive_retention_days).where(
                tuple_(CollectPoint.source_id, CollectPoint.code).in_(
                    list(points)
                )
            )
        )
        return list(rows.scalars().all())

    async def codes_of(
        self, session: AsyncSession, source_id: uuid.UUID, *, limit: int
    ) -> list[str]:
        """一个数据源下前 `limit` 个点位编码，按编码升序。

        ⚠ 排序必须写死：实时推送按这个顺序取前 N 个点位，顺序不定就等于
        「每次重读换一批点位有实时值」，而界面上看不出任何原因。
        Args: session, source_id, limit。
        """
        rows = await session.execute(
            select(CollectPoint.code)
            .where(CollectPoint.source_id == source_id)
            .order_by(CollectPoint.code.asc(), CollectPoint.id.asc())
            .limit(limit)
        )
        return list(rows.scalars().all())

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
