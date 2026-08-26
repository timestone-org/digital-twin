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
                **_driver_cause(error),
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


def _driver_cause(error: SQLAlchemyError) -> dict[str, str]:
    """驱动那一层的错误类名与 SQLSTATE，两样都是低基数的稳定字面量。

    ⚠ 只取名字与状态码，**不取消息本体**：驱动的消息里带着这一次的绑定值，
    那是请求体全文，不许进日志（observability §1）。
    ⚠ 但也不能只留 `DBAPIError` 这一个外层名：`DataError/22000`（绑错了参数
    类型，重试一万次也不会好）与 `ConnectionDoesNotExistError`（库真的断了）
    在外层名下长得一模一样，而这一面对外一律是 503「请稍后重试」——分不出这
    两者时，一个必然失败的查询会被当成抖动看上好几个月。
    Args: error。
    """
    cause = getattr(getattr(error, "orig", None), "__cause__", None)
    if cause is None:
        return {}
    return {
        "driver_error": type(cause).__name__,
        "sqlstate": str(getattr(cause, "sqlstate", "")),
    }
