"""归档宽表的数据访问。事务归调用方（archive/writer.py），本层不提交。"""

from collections.abc import Mapping, Sequence
from typing import Any, cast

from sqlalchemy import CursorResult
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from collector_server.apps.collect.models.point_history import PointHistory
from timeseries import HISTORY_COLUMNS, PRIMARY_KEY_COLUMNS

# asyncpg 单条语句的绑定参数上限，超过它是运行期报错不是慢
ASYNCPG_MAX_BIND_PARAMS = 32767
# 一条多行 INSERT 的行数上限 = 参数上限 ÷ 列数。⚠ 批大小可配，但必须先过
# 这道收敛：六列时 5461 行就把参数用光了
MAX_INSERT_ROWS = ASYNCPG_MAX_BIND_PARAMS // len(HISTORY_COLUMNS)


class PointHistoryCrud:
    """`collect.point_history` 的数据访问。"""

    async def insert_many(
        self, session: AsyncSession, rows: Sequence[Mapping[str, Any]]
    ) -> int:
        """批量写入并返回真正落库的行数。

        ⚠ 走 `ON CONFLICT DO NOTHING`，把 Stream 的 at-least-once 提升成实际
        的 exactly-once：leader 切换、消费者重启与重投都会重复投递，主键去重
        是唯一的防线（COLLECT_DESIGN.md §4.3）。

        Args: session, rows。
        """
        if not rows:
            return 0
        statement = (
            insert(PointHistory)
            .values(list(rows))
            .on_conflict_do_nothing(index_elements=list(PRIMARY_KEY_COLUMNS))
        )
        result = await session.execute(statement)
        # cast 的理由 —— DML 的 execute 运行期返回 CursorResult，而 AsyncSession
        # 的静态签名只承诺 Result，`rowcount` 在后者上不存在
        return cast("CursorResult[Any]", result).rowcount
