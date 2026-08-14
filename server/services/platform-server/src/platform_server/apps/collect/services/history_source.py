"""归档宽表的只读连接。

⚠ 独立连接池 + 独立事务：`collect` schema 归 collector-server 写独占，平台侧
只许读（ADR-0003）。**不与业务写事务共用连接**——一次跨月扫描会把写连接连同
它持有的锁一起占住。
"""

from collections.abc import Mapping
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from lib.db import Database
from lib.logging import get_logger
from platform_server.apps.collect.errors import HistoryUnavailable

_logger = get_logger("platform.collect.history")

# ⚠ 必须是这个事务里的第一条语句：Postgres 只允许在事务尚未做过任何读写时
# 声明它只读。放到第二条就静默失效，而这个连接从此可以写别人的 schema
_READ_ONLY = text("SET TRANSACTION READ ONLY")


@dataclass(frozen=True)
class ReadOnlyHistorySource:
    """打归档库的只读查询面。"""

    database: Database

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]:
        """跑一条只读查询，把结果行按列名映射成字典。

        Args: sql, params（值一律绑定参数）。
        """
        try:
            return await self._read(sql, dict(params))
        except SQLAlchemyError as error:
            _logger.error(
                "history_query_failed",
                "归档库查询失败",
                error_type=type(error).__name__,
            )
            raise HistoryUnavailable(
                "历史数据暂时读不了，请稍后重试"
            ) from error

    async def _read(
        self, sql: str, params: dict[str, object]
    ) -> list[dict[str, object]]:
        async with self.database.session() as session:
            await session.execute(_READ_ONLY)
            rows = await session.execute(text(sql), params)
            return [dict(row) for row in rows.mappings().all()]
