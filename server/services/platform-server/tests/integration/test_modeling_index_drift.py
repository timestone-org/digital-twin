"""建模各表在迁移里建的索引，ORM 模型上也都声明了。

⚠ 模型上漏声明的索引，下一次 `alembic revision --autogenerate` 会提议删掉它，
没人细看就把游标列表与归档筛选打回全表扫描。
"""

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.models import Base

pytestmark = pytest.mark.requires_postgres


def _dropped_indexes(connection: Connection) -> list[str]:
    """自动生成会提议删掉的建模表索引名。

    Args: connection。
    """
    context = MigrationContext.configure(
        connection, opts={"include_schemas": True}
    )
    return [
        diff[1].name
        for diff in compare_metadata(context, Base.metadata)
        if isinstance(diff, tuple)
        and diff[0] == "remove_index"
        and str(diff[1].table.name).startswith("modeling_")
    ]


async def test_no_modeling_index_would_be_dropped_by_autogenerate(
    db_session: AsyncSession,
) -> None:
    connection = await db_session.connection()
    assert await connection.run_sync(_dropped_indexes) == []
