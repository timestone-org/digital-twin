"""谁在看哪张大屏 —— 由 realtime-hub 的订阅关系推导。

**只推有人在看的大屏**这条要求需要一个「活跃集合」，而它只能有一个来源：
hub 手里的订阅关系。参考实现的做法是让 hub 在订阅/退订时另外维护一份
「活跃看板 / 观看者」登记，供业务服务查询——那是**通道服务替业务保管业务
状态**，ADR-0007 §理由一点名反对。

本仓的方向相反：hub 的 `realtime.subscription` 里只有「连接 × 主题」，两列
都不是业务字段，主题对它就是一个不透明键；把 `dashboard:{id}` 读成一张大屏
的这一步发生在**这里**。hub 因此不认识大屏，删掉本模块它也照常工作。

⚠ 跨 schema **只读**：`realtime` 归 hub 写独占（ADR-0003），本服务走独立
只读连接池 + `SET TRANSACTION READ ONLY`，不 JOIN、不建外键、不共用事务。
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from lib.db import Database
from lib.errors import DependencyUnavailable
from lib.logging import get_logger
from platform_server.apps.dashboard.services.topics import (
    TOPIC_PREFIX,
    TOPIC_SEPARATOR,
    dashboard_id_of,
)

_logger = get_logger("platform.dashboard.viewers")

# 表与列的名字复述自 realtime-hub 的 `models/subscription.py`。⚠ 跨 schema 读
# 不许共享 ORM 模型，只能复述，故由契约测试两侧比对（ADR-0003 代价四）
SUBSCRIPTION_SCHEMA = "realtime"
SUBSCRIPTION_TABLE = f"{SUBSCRIPTION_SCHEMA}.subscription"
TOPIC_COLUMN = "topic"
CONNECTION_COLUMN = "connection_id"

# ⚠ 必须是这个事务里的第一条语句：Postgres 只允许在事务尚未做过任何读写时
# 声明它只读。放到第二条就静默失效，而这个连接从此可以写别人的 schema
_READ_ONLY = text("SET TRANSACTION READ ONLY")
# ⚠ 表名完全限定，不靠 search_path：配错时要的是「表不存在」，不是静默命中
# 本服务 schema 里某张同名表
# 抑制 S608 的理由 —— 拼进 SQL 的只有本模块的表名与列名常量，唯一的外部输入
# 是 `:topic_prefix` 绑定参数
_SELECT = (
    f"SELECT {TOPIC_COLUMN}, {CONNECTION_COLUMN}"  # noqa: S608
    f" FROM {SUBSCRIPTION_TABLE}"
    f" WHERE {TOPIC_COLUMN} LIKE :topic_prefix"
)
_TOPIC_PREFIX = f"{TOPIC_PREFIX}{TOPIC_SEPARATOR}%"


class ViewerSource(Protocol):
    """订阅关系的最小只读面。真实现打 Postgres，测试用进程内假件。"""

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]: ...


@dataclass(frozen=True)
class ReadOnlyViewerSource:
    """打 hub 那张订阅表的只读连接。

    ⚠ 与业务写事务分池：发布循环每一拍都要问一次，而它问的是别人的 schema。
    """

    database: Database

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]:
        """跑一条只读查询，把结果行按列名映射成字典。

        Args: sql, params（值一律绑定参数）。
        """
        try:
            async with self.database.session() as session:
                await session.execute(_READ_ONLY)
                rows = await session.execute(text(sql), dict(params))
                return [dict(row) for row in rows.mappings().all()]
        except SQLAlchemyError as error:
            raise DependencyUnavailable(
                "订阅关系暂时读不了", context={"dependency": "postgres"}
            ) from error


@dataclass(frozen=True)
class SubscriptionViewers:
    """把订阅关系读成「哪张大屏上有哪些连接在看」。"""

    source: ViewerSource

    async def active(self) -> dict[uuid.UUID, frozenset[uuid.UUID]]:
        """当前有人在看的大屏，以及看它的那些连接。

        ⚠ 返回的是**连接集合**而不是计数：新观看者要收一帧全量，而「多了一
        条连接」与「换了一条连接」在计数上分不开——人数不变的换人会让新来的
        那位一直空着，直到某个值恰好变化。
        """
        rows = await self.source.fetch_all(
            _SELECT, {"topic_prefix": _TOPIC_PREFIX}
        )
        return group_by_dashboard(rows)


def group_by_dashboard(
    rows: Sequence[Mapping[str, object]],
) -> dict[uuid.UUID, frozenset[uuid.UUID]]:
    """把订阅行按大屏归并，认不出的主题与连接一律丢掉。

    Args: rows。
    """
    grouped: dict[uuid.UUID, set[uuid.UUID]] = {}
    for row in rows:
        dashboard_id = _dashboard_of(row)
        connection_id = _connection_of(row)
        if dashboard_id is None or connection_id is None:
            continue
        grouped.setdefault(dashboard_id, set()).add(connection_id)
    return {
        dashboard_id: frozenset(connections)
        for dashboard_id, connections in grouped.items()
    }


def _dashboard_of(row: Mapping[str, object]) -> uuid.UUID | None:
    topic = row.get(TOPIC_COLUMN)
    if not isinstance(topic, str):
        return None
    return dashboard_id_of(topic)


def _connection_of(row: Mapping[str, object]) -> uuid.UUID | None:
    connection = row.get(CONNECTION_COLUMN)
    if isinstance(connection, uuid.UUID):
        return connection
    if not isinstance(connection, str):
        return None
    try:
        return uuid.UUID(connection)
    except ValueError:
        _logger.warning(
            "subscription_row_malformed", "订阅行的连接标识不是 UUID，已跳过"
        )
        return None
