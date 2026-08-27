"""谁在看哪个数据源 —— 由 realtime-hub 的订阅关系推导。

与大屏那侧同源：hub 的 `realtime.subscription` 里只有「连接 × 主题」，把
`collect:{source_id}` 读成一个数据源的这一步发生在**这里**，hub 因此不认识
数据源（ADR-0007）。

⚠ 只有**有人打开采集配置页**时才推：采集配置页不是大屏，绝大多数时间一个
人都没有。按订阅关系推导而不是「给每个启用的数据源都推」，让一台挂了上万
点位的设备在没人看时零推送开销。

⚠ 只读面复用 `apps/dashboard` 的 `ViewerSource`：它只认「一条只读 SQL」，
一个大屏名词也没有；跨功能模块走 services 公开面是允许的方向，反向才是环。
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from lib.logging import get_logger
from platform_server.apps.collect.services.topics import (
    TOPIC_PREFIX,
    TOPIC_SEPARATOR,
    source_id_of,
)
from platform_server.apps.dashboard.services import ViewerSource
from platform_server.apps.dashboard.services.viewers import (
    ID_COLUMN,
    SUBSCRIPTION_TABLE,
    TOPIC_COLUMN,
)

_logger = get_logger("platform.collect.watchers")

# 抑制 S608 的理由 —— 拼进 SQL 的只有复述自 hub 的表名与列名常量，唯一的
# 外部输入是 `:topic_prefix` 绑定参数
_SELECT = (
    f"SELECT {TOPIC_COLUMN}, {ID_COLUMN}"  # noqa: S608
    f" FROM {SUBSCRIPTION_TABLE}"
    f" WHERE {TOPIC_COLUMN} LIKE :topic_prefix"
)
_TOPIC_PREFIX = f"{TOPIC_PREFIX}{TOPIC_SEPARATOR}%"


@dataclass(frozen=True)
class SubscriptionWatchers:
    """把订阅关系读成「哪个数据源上有哪些订阅在看」。"""

    source: ViewerSource

    async def active(self) -> dict[uuid.UUID, frozenset[uuid.UUID]]:
        """当前有人在看的数据源，以及看它的那些**订阅行**。

        ⚠ 返回订阅行 id 的集合而不是连接集合或计数：新观看者要收一帧全量，
        而「换了一条连接」「同一条连接退订又重订」（SPA 切页面）在连接 id 上
        分不开——后者退订即删行、重订即插新行，只有行 id 认得出来（理由详见
        大屏侧 `viewers.py`）。
        """
        rows = await self.source.fetch_all(
            _SELECT, {"topic_prefix": _TOPIC_PREFIX}
        )
        return group_by_source(rows)


def group_by_source(
    rows: Sequence[Mapping[str, object]],
) -> dict[uuid.UUID, frozenset[uuid.UUID]]:
    """把订阅行按数据源归并，认不出的主题与行标识一律丢掉。

    Args: rows。
    """
    grouped: dict[uuid.UUID, set[uuid.UUID]] = {}
    for row in rows:
        source_id = _source_of(row)
        subscription_id = _subscription_of(row)
        if source_id is None or subscription_id is None:
            continue
        grouped.setdefault(source_id, set()).add(subscription_id)
    return {
        source_id: frozenset(subscriptions)
        for source_id, subscriptions in grouped.items()
    }


def _source_of(row: Mapping[str, object]) -> uuid.UUID | None:
    topic = row.get(TOPIC_COLUMN)
    if not isinstance(topic, str):
        return None
    return source_id_of(topic)


def _subscription_of(row: Mapping[str, object]) -> uuid.UUID | None:
    subscription = row.get(ID_COLUMN)
    if isinstance(subscription, uuid.UUID):
        return subscription
    if not isinstance(subscription, str):
        return None
    try:
        return uuid.UUID(subscription)
    except ValueError:
        _logger.warning(
            "subscription_row_malformed", "订阅行的标识不是 UUID，已跳过"
        )
        return None
