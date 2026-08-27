"""发布一拍：有人在看的数据源 → 点位清单 → 快照取值 → 合并批推。

采集配置页的实时值走的就是这条链路（COLLECT_DESIGN §9）。四条口径与大屏那
侧同源，只是「一屏」换成了「一个数据源」：

- **只推有人在看的数据源**，活跃集合由 hub 的订阅关系推导（`watchers.py`）。
  配置页绝大多数时间没人开着，没人看就零开销。
- **新观看者来了推一次全量**：hub 只转发推送方给的东西，刚订阅的客户端不会
  凭空收到当前值，不补全量的话页面会一直空着直到某个值恰好变化。
- **点位清单变了也推全量**：新建的点位不该等到它下一次变化才第一次出现。
- **一条链路只有一层负责重试**：推失败就丢这一批并记日志，客户端据 `seq`
  的缺口自己发现。这里重推会与下一拍抢顺序。
"""

import time
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from lib.errors import DependencyUnavailable
from lib.logging import current_traceparent, get_logger
from platform_server.apps.collect.services.live_plan import (
    LivePlan,
    LivePlanSource,
)
from platform_server.apps.collect.services.point_frames import (
    UNAVAILABLE_REASON,
    Item,
    build_items,
    changed_items,
    error_items,
    index_by_node_key,
    shards,
)
from platform_server.apps.collect.services.snapshot_source import (
    SnapshotSource,
)
from platform_server.apps.collect.services.topics import topic_of
from platform_server.apps.collect.services.watchers import SubscriptionWatchers
from platform_server.realtime import FramePublisher

_logger = get_logger("platform.collect.live")

# 单调时钟，秒。⚠ 不能用墙钟：改系统时间会让重读周期一次跳过或永远不到期
Ticker = Callable[[], float]


@dataclass(frozen=True)
class LiveOptions:
    """一拍的节流与截断参数。窗口本身归调用方的循环。"""

    max_items: int
    max_points: int
    plan_ttl_s: float


@dataclass(frozen=True)
class LiveReport:
    """一拍推了多少。给日志与用例看。"""

    sources: int
    items: int


@dataclass
class _Cached:
    """一个数据源的进程内缓存：清单、它的读入时刻、上一次推出去的条目。"""

    plan: LivePlan
    loaded_at_s: float
    sent: dict[str, Item] = field(default_factory=dict[str, Item])


@dataclass
class SourceLivePublisher:
    """按活跃集合推数据源实时值。一个进程一份，只在持租约时被调用。"""

    plans: LivePlanSource
    watchers: SubscriptionWatchers
    snapshots: SnapshotSource
    realtime: FramePublisher
    options: LiveOptions
    ticker: Ticker = time.monotonic
    _watched: dict[uuid.UUID, frozenset[uuid.UUID]] = field(
        default_factory=dict[uuid.UUID, frozenset[uuid.UUID]], init=False
    )
    _cache: dict[uuid.UUID, _Cached] = field(
        default_factory=dict[uuid.UUID, _Cached], init=False
    )

    async def publish_once(self) -> LiveReport:
        """跑一拍：把每个有人在看的数据源推一批。

        ⚠ 读订阅关系失败时整拍放弃并抛给循环：此刻我们不知道谁在看，而
        「按上一拍的名单继续推」等于拿一份可能已经过期的活跃集合当真。
        """
        watched = await self.watchers.active()
        self._forget_gone(watched)
        total = 0
        for source_id, subscriptions in watched.items():
            # ⚠ 差集按订阅行 id 算：同一条连接退订又重订（SPA 切页面）也是
            # 一位新观看者，连接 id 认不出他（见 watchers.py）
            is_new = bool(
                subscriptions - self._watched.get(source_id, frozenset())
            )
            total += await self._publish_one(source_id, is_new=is_new)
            self._watched[source_id] = subscriptions
        return LiveReport(sources=len(watched), items=total)

    def forget_all(self) -> None:
        """丢掉全部进程内缓存。丢主时用：接任者会从全量帧重新开始。"""
        self._watched.clear()
        self._cache.clear()

    async def _publish_one(self, source_id: uuid.UUID, *, is_new: bool) -> int:
        """推一个数据源，返回真正推出去的条目数。

        Args: source_id, is_new。
        """
        entry, is_changed = await self._plan_of(source_id)
        if entry is None or not entry.plan.node_keys:
            return 0
        node_keys = entry.plan.node_keys
        is_full = is_new or is_changed
        items = await self._items_of(source_id, node_keys)
        outgoing = items if is_full else changed_items(items, entry.sent)
        if not outgoing:
            return 0
        if is_full:
            # 全量帧覆盖整份清单，顺手把已经不在清单里的键清掉
            entry.sent.clear()
        return await self._send(source_id, entry, outgoing)

    async def _items_of(
        self, source_id: uuid.UUID, node_keys: tuple[str, ...]
    ) -> list[Item]:
        """取一批点位的值并装成条目。快照读不到就整批标成取不到。

        Args: source_id, node_keys。
        """
        try:
            readings = await self.snapshots.read(node_keys)
        except DependencyUnavailable:
            _logger.error(
                "snapshot_read_failed",
                "读点位快照失败，本数据源整批标为取不到",
                source_id=str(source_id),
                points=len(node_keys),
            )
            return error_items(node_keys, reason=UNAVAILABLE_REASON)
        return build_items(node_keys, readings)

    async def _send(
        self, source_id: uuid.UUID, entry: _Cached, outgoing: list[Item]
    ) -> int:
        """分片推给 hub，返回推成功的条目数。

        ⚠ 只把**真的推出去**的那几片记进已发送表：记多了会让下一拍误以为
        客户端已经有这些值，那批数据就永远补不回来。
        Args: source_id, entry, outgoing。
        """
        topic = topic_of(source_id)
        traceparent = current_traceparent()
        total = 0
        for shard in shards(outgoing, self.options.max_items):
            is_sent = await self.realtime.publish(
                topic=topic, items=shard, traceparent=traceparent
            )
            if not is_sent:
                _logger.warning(
                    "collect_frame_dropped",
                    "一批采集实时值没能推出去，客户端会看到 seq 缺口",
                    source_id=str(source_id),
                    items=len(shard),
                )
                return total
            entry.sent.update(index_by_node_key(shard))
            total += len(shard)
        return total

    async def _plan_of(
        self, source_id: uuid.UUID
    ) -> tuple[_Cached | None, bool]:
        """取一个数据源的点位清单，返回 (缓存项, 清单是否变过)。

        ⚠ 到期重读**不等于**清单变了：不比对就会每个 TTL 推一帧全量，一台
        上万点位的设备因此每 10 秒重推一次全量。
        Args: source_id。
        """
        cached = self._cache.get(source_id)
        if cached is not None and not self._is_stale(cached):
            return cached, False
        plan = await self.plans.load(source_id, limit=self.options.max_points)
        if plan is None:
            # 数据源没了：主题对账那一支会把它的主题注销掉
            self._forget(source_id)
            return None, False
        is_changed = cached is None or cached.plan.node_keys != plan.node_keys
        entry = _Cached(
            plan=plan,
            loaded_at_s=self.ticker(),
            # 清单没变就把已发送表带过来：清空它等于下一拍重推一遍全量
            sent={} if cached is None else cached.sent,
        )
        self._cache[source_id] = entry
        return entry, is_changed

    def _is_stale(self, cached: _Cached) -> bool:
        return self.ticker() - cached.loaded_at_s >= self.options.plan_ttl_s

    def _forget_gone(
        self, watched: Mapping[uuid.UUID, frozenset[uuid.UUID]]
    ) -> None:
        """没人看了的数据源一律清缓存，进程内状态不随数据源数无限涨。

        Args: watched。
        """
        for source_id in list(self._watched):
            if source_id not in watched:
                self._forget(source_id)

    def _forget(self, source_id: uuid.UUID) -> None:
        self._watched.pop(source_id, None)
        self._cache.pop(source_id, None)
