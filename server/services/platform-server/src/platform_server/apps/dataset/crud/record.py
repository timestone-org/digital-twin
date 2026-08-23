"""台账行的数据访问。删表时的清行也在这里——超表上没有外键可以级联。"""

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.dataset.models import DatasetRecord


class RecordCrud(CrudBase[DatasetRecord]):
    """`dataset_records` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(DatasetRecord)

    async def count_by_table(
        self, session: AsyncSession, table_id: uuid.UUID
    ) -> int:
        """一张台账下有多少行。

        Args: session, table_id。
        """
        rows = await session.execute(
            select(func.count())
            .select_from(DatasetRecord)
            .where(DatasetRecord.table_id == table_id)
        )
        return int(rows.scalar_one())

    async def delete_by_table(
        self, session: AsyncSession, table_id: uuid.UUID
    ) -> None:
        """删掉一张台账的全部行。

        ⚠ 超表上没有指向 `dataset_tables` 的外键，删表不会级联，必须显式清行；
        不清就是一批永远查不到、也永远删不掉的孤儿行（§4.2）。
        Args: session, table_id。
        """
        await session.execute(
            delete(DatasetRecord).where(DatasetRecord.table_id == table_id)
        )


record_crud = RecordCrud()
