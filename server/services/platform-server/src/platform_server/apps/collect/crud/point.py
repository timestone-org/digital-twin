"""点位数据访问。"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

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

PointCursor = tuple[uuid.UUID, str, uuid.UUID]


@dataclass(frozen=True)
class PointCandidate:
    """状态筛选所需的点位身份与排序锚点。"""

    id: uuid.UUID
    source_id: uuid.UUID
    code: str

    @property
    def cursor(self) -> PointCursor:
        return self.source_id, self.code, self.id


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

    async def list_candidates(
        self,
        session: AsyncSession,
        *,
        filters: tuple[uuid.UUID | None, str | None],
        after: PointCursor | None,
        limit: int,
    ) -> list[PointCandidate]:
        """按稳定锚点读取一批候选。

        Args: session, filters, after, limit。
        """
        source_id, keyword = filters
        statement = self.build_query(
            source_id=source_id, keyword=keyword
        ).with_only_columns(
            CollectPoint.id, CollectPoint.source_id, CollectPoint.code
        )
        if after is not None:
            statement = statement.where(
                tuple_(
                    CollectPoint.source_id, CollectPoint.code, CollectPoint.id
                )
                > after
            )
        rows = await session.execute(
            statement.order_by(*DEFAULT_ORDER).limit(limit)
        )
        return [
            PointCandidate(id=point_id, source_id=source_id, code=code)
            for point_id, source_id, code in rows.tuples()
        ]

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

    async def lock_by_codes(
        self,
        session: AsyncSession,
        source_id: uuid.UUID,
        codes: Sequence[str],
    ) -> list[CollectPoint]:
        """按源与编码批量锁定已有点位。

        Args: session, source_id, codes。
        """
        statement = (
            select(CollectPoint)
            .where(
                CollectPoint.source_id == source_id,
                CollectPoint.code.in_(list(codes)),
            )
            .order_by(CollectPoint.code)
            .with_for_update()
        )
        result = await session.execute(
            statement.execution_options(populate_existing=True)
        )
        return list(result.scalars().all())

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
        self, session: AsyncSession, source_id: uuid.UUID, *, batch_size: int
    ) -> list[str]:
        """用分批游标读取一个数据源的全部点位编码，按编码升序。

        Args: session, source_id, batch_size。
        """
        if batch_size < 1:
            raise ValueError("点位读取批大小必须大于零")
        # ⚠ 一个 SELECT 游标的各批共享快照，点位增删不会让分页重复或漏行。
        rows = await session.stream(
            select(CollectPoint.code)
            .where(CollectPoint.source_id == source_id)
            .order_by(CollectPoint.code.asc(), CollectPoint.id.asc())
            .execution_options(yield_per=batch_size)
        )
        codes: list[str] = []
        try:
            async for batch in rows.scalars().partitions(batch_size):
                codes.extend(batch)
        finally:
            await rows.close()
        return codes

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
            statement = statement.where(
                CollectPoint.name.icontains(keyword, autoescape=True)
                | CollectPoint.code.icontains(keyword, autoescape=True)
            )
        return statement


point_crud = PointCrud()
