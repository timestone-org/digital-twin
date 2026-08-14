"""归档落库的出口：事务边界在这里，crud 只出语句。"""

from collections.abc import Iterator, Mapping, Sequence
from typing import Any

from collector_server.apps.collect.crud.point_history import (
    MAX_INSERT_ROWS,
    PointHistoryCrud,
)
from lib.db import Database


class PointHistoryService:
    """把一批行写进 `collect.point_history`。"""

    def __init__(self, *, database: Database, batch_rows: int) -> None:
        """按数据库句柄与批大小初始化。

        ⚠ 批大小先过 asyncpg 的绑定参数上限：配大了不是慢，是运行期报错。

        Args: database, batch_rows。
        """
        self._database = database
        self._crud = PointHistoryCrud()
        self._batch_rows = min(max(batch_rows, 1), MAX_INSERT_ROWS)

    @property
    def batch_rows(self) -> int:
        """一条 INSERT 实际带多少行。"""
        return self._batch_rows

    async def store(self, rows: Sequence[Mapping[str, Any]]) -> int:
        """一批行一个事务，批内再按参数上限切片；返回真正落库的行数。

        ⚠ 写失败**向上抛**：调用方要靠它决定「别删 Stream 里的条目」。这与
        运行态上报不同——那条是旁路数据，这条是历史本身。

        Args: rows。
        """
        if not rows:
            return 0
        stored = 0
        async with self._database.session() as session:
            for batch in _batched(rows, self._batch_rows):
                stored += await self._crud.insert_many(session, batch)
        return stored


def _batched(
    rows: Sequence[Mapping[str, Any]], size: int
) -> Iterator[Sequence[Mapping[str, Any]]]:
    """按上限切批。

    Args: rows, size。
    """
    for start in range(0, len(rows), size):
        yield rows[start : start + size]
