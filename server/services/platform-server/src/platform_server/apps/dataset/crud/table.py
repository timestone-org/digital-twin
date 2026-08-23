"""台账定义的数据访问。"""

import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.dataset.models import DatasetColumn, DatasetTable

SORTABLE = {
    "code": DatasetTable.code,
    "name": DatasetTable.name,
    "created_at": DatasetTable.created_at,
}
# ⚠ 排序写死：两次列出同一批台账不保证同序的话，Agent 就无法靠 diff 判断
# 自己这一步改了什么
DEFAULT_ORDER = (DatasetTable.code.asc(), DatasetTable.id.asc())

# LIKE 的两个通配符与转义符自身。⚠ 不转义的话，搜「50%」会退化成「列全部」，
# 而现象只是「搜索好像没生效」——没有任何一处会报错
_LIKE_SPECIALS = str.maketrans({"\\": r"\\", "%": r"\%", "_": r"\_"})


class TableCrud(CrudBase[DatasetTable]):
    """`dataset_tables` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(DatasetTable)

    async def get_by_code(
        self, session: AsyncSession, code: str
    ) -> DatasetTable | None:
        """按编码取一行。

        Args: session, code。
        """
        rows = await session.execute(
            select(DatasetTable).where(DatasetTable.code == code)
        )
        return rows.scalars().first()

    async def list_all(self, session: AsyncSession) -> list[DatasetTable]:
        """全部台账，按编码升序。跨表引用的候选清单要它。

        Args: session。
        """
        rows = await session.execute(
            select(DatasetTable).order_by(*DEFAULT_ORDER)
        )
        return list(rows.scalars().all())

    async def all_codes(self, session: AsyncSession) -> frozenset[str]:
        """全部台账编码。跨表引用的存在性校验要拿它当已知集合。

        ⚠ 集合有界（业务台账是几十张级别），故整份取回而不逐个查。
        Args: session。
        """
        rows = await session.execute(select(DatasetTable.code))
        return frozenset(rows.scalars().all())

    async def column_counts(
        self, session: AsyncSession, table_ids: frozenset[uuid.UUID]
    ) -> dict[uuid.UUID, int]:
        """批量取每张台账的列数，避免列表页 N+1。

        Args: session, table_ids。
        """
        if not table_ids:
            return {}
        rows = await session.execute(
            select(DatasetColumn.table_id, func.count())
            .where(DatasetColumn.table_id.in_(table_ids))
            .group_by(DatasetColumn.table_id)
        )
        counts = dict.fromkeys(table_ids, 0)
        for table_id, total in rows.all():
            counts[table_id] = int(total)
        return counts

    @staticmethod
    def build_query(*, keyword: str | None) -> Select[tuple[DatasetTable]]:
        """按关键字构造列表查询。

        Args: keyword（按名称与编码模糊搜）。
        """
        statement = select(DatasetTable)
        if keyword:
            pattern = f"%{keyword.translate(_LIKE_SPECIALS)}%"
            statement = statement.where(
                DatasetTable.name.ilike(pattern, escape="\\")
                | DatasetTable.code.ilike(pattern, escape="\\")
            )
        return statement


table_crud = TableCrud()
