"""列定义的数据访问。"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.dataset.models import DatasetColumn

# ⚠ 第二、第三排序键不能省：`order_index` 允许并列，只按它排时两次读取的列序
# 可以不同，表头于是会在两次刷新之间自己换位置
DEFAULT_ORDER = (
    DatasetColumn.order_index.asc(),
    DatasetColumn.key.asc(),
    DatasetColumn.id.asc(),
)


class ColumnCrud(CrudBase[DatasetColumn]):
    """`dataset_columns` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(DatasetColumn)

    async def list_by_table(
        self, session: AsyncSession, table_id: uuid.UUID
    ) -> list[DatasetColumn]:
        """一张台账的全部列，顺序写死。

        Args: session, table_id。
        """
        rows = await session.execute(
            select(DatasetColumn)
            .where(DatasetColumn.table_id == table_id)
            .order_by(*DEFAULT_ORDER)
        )
        return list(rows.scalars().all())

    async def get_by_key(
        self, session: AsyncSession, table_id: uuid.UUID, key: str
    ) -> DatasetColumn | None:
        """按 `(table_id, key)` 取一列。

        Args: session, table_id, key。
        """
        rows = await session.execute(
            select(DatasetColumn).where(
                DatasetColumn.table_id == table_id,
                DatasetColumn.key == key,
            )
        )
        return rows.scalars().first()

    async def next_order_index(
        self, session: AsyncSession, table_id: uuid.UUID
    ) -> int:
        """新列排到最后时该拿的序号。空表从 0 起。

        Args: session, table_id。
        """
        rows = await session.execute(
            select(func.max(DatasetColumn.order_index)).where(
                DatasetColumn.table_id == table_id
            )
        )
        highest = rows.scalar_one_or_none()
        return 0 if highest is None else int(highest) + 1

    async def dependents_of(
        self, session: AsyncSession, *, table_id: uuid.UUID, key: str
    ) -> list[DatasetColumn]:
        """同表内公式依赖这一列的其它列。

        ⚠ 读的是保存公式时解析出的 `formula_deps`，不在这里重解析公式原文：
        解析器归公式引擎（第 2 期），两份实现必然漂移。
        Args: session, table_id, key。
        """
        rows = await session.execute(
            select(DatasetColumn)
            .where(
                DatasetColumn.table_id == table_id,
                DatasetColumn.key != key,
                DatasetColumn.formula_deps.contains([key]),
            )
            .order_by(*DEFAULT_ORDER)
        )
        return list(rows.scalars().all())


column_crud = ColumnCrud()
