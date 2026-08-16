"""发布一拍：活跃大屏 → 绑定计划 → 快照取值 → 合并批推。

四条口径：

- **只推有人在看的大屏**，活跃集合由 hub 的订阅关系推导（`viewers.py`）。
- **新观看者来了推一次全量**，运行态零 HTTP，首帧初值也走 WS
  （DASHBOARD_DESIGN §6.1）。绑定计划变了同样推全量：新绑上的点位不该等到
  它下一次变化才第一次出现。
- **绑定计划按 `row_version` 判断要不要重读**：结构变更必推进它，比每拍重读
  整棵节点树便宜得多。
- **一条链路只有一层负责重试**：推失败就丢这一批并记日志，客户端据 `seq`
  的缺口自己发现。这里重推会与下一拍抢顺序。
"""

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from lib.errors import DependencyUnavailable
from lib.logging import get_logger
from platform_server.apps.collect.services import SnapshotSource
from platform_server.apps.collect.services.point_frames import (
    UNAVAILABLE_REASON,
    Item,
    build_items,
    changed_items,
    error_items,
    index_by_node_key,
    now_ms,
    shards,
)
from platform_server.apps.dashboard.services.publish_plan import (
    DashboardPlan,
    PlanSource,
)
from platform_server.apps.dashboard.services.topics import topic_of
from platform_server.apps.dashboard.services.viewers import SubscriptionViewers
from platform_server.realtime import FramePublisher, current_traceparent

_logger = get_logger("platform.dashboard.publish")

Clock = Callable[[], int]


@dataclass(frozen=True)
class PublishOptions:
    """一拍的节流参数。窗口本身归调用方的循环。"""

    max_items: int
    stale_after_ms: int


@dataclass(frozen=True)
class PublishReport:
    """一拍推了多少。给日志与用例看。"""

    dashboards: int
    items: int


@dataclass
class DashboardPublisher:
    """按活跃集合推大屏实时值。一个进程一份，只在持租约时被调用。"""

    plans: PlanSource
    viewers: SubscriptionViewers
    snapshots: SnapshotSource
    realtime: FramePublisher
    options: PublishOptions
    clock: Clock = now_ms
    _watchers: dict[uuid.UUID, frozenset[uuid.UUID]] = field(
        default_factory=dict[uuid.UUID, frozenset[uuid.UUID]], init=False
    )
    _plans: dict[uuid.UUID, DashboardPlan] = field(
        default_factory=dict[uuid.UUID, DashboardPlan], init=False
    )
    # 上一次推出去的条目，按大屏 → 点位身份索引。增量帧靠它比对
    _sent: dict[uuid.UUID, dict[str, Item]] = field(
        default_factory=dict[uuid.UUID, dict[str, Item]], init=False
    )

    async def publish_once(self) -> PublishReport:
        """跑一拍：把每张有人在看的大屏推一批。

        ⚠ 读订阅关系失败时整拍放弃并抛给循环：此刻我们不知道谁在看，而
        「按上一拍的名单继续推」等于拿一份可能已经过期的活跃集合当真。
        """
        watchers = await self.viewers.active()
        self._forget_gone(watchers)
        total = 0
        for dashboard_id, connections in watchers.items():
            is_full = self._is_new_audience(dashboard_id, connections)
            total += await self._publish_one(dashboard_id, is_full=is_full)
            self._watchers[dashboard_id] = connections
        return PublishReport(dashboards=len(watchers), items=total)

    def forget_all(self) -> None:
        """丢掉全部进程内缓存。丢主时用：接任者会从全量帧重新开始。"""
        self._watchers.clear()
        self._plans.clear()
        self._sent.clear()

    async def _publish_one(
        self, dashboard_id: uuid.UUID, *, is_full: bool
    ) -> int:
        """推一张大屏，返回真正推出去的条目数。

        Args: dashboard_id, is_full。
        """
        plan, is_reloaded = await self._plan_of(dashboard_id)
        if plan is None or not plan.node_keys:
            return 0
        is_full_frame = is_full or is_reloaded
        items = await self._items_of(plan, dashboard_id)
        outgoing = (
            items
            if is_full_frame
            else changed_items(items, self._sent.get(dashboard_id, {}))
        )
        if not outgoing:
            return 0
        if is_full_frame:
            # 全量帧覆盖全屏点位，顺手把计划里已经没有的键清掉
            self._sent[dashboard_id] = {}
        return await self._send(dashboard_id, outgoing)

    async def _items_of(
        self, plan: DashboardPlan, dashboard_id: uuid.UUID
    ) -> list[Item]:
        """取一屏的值并装成条目。快照读不到就整批标成取不到。

        Args: plan, dashboard_id。
        """
        try:
            readings = await self.snapshots.read(plan.node_keys)
        except DependencyUnavailable:
            _logger.error(
                "snapshot_read_failed",
                "读点位快照失败，本屏整批标为取不到",
                dashboard_id=str(dashboard_id),
                points=len(plan.node_keys),
            )
            return error_items(plan.node_keys, reason=UNAVAILABLE_REASON)
        return build_items(
            plan.node_keys,
            readings,
            at_ms=self.clock(),
            stale_after_ms=self.options.stale_after_ms,
        )

    async def _send(self, dashboard_id: uuid.UUID, outgoing: list[Item]) -> int:
        """分片推给 hub，返回推成功的条目数。

        ⚠ 只把**真的推出去**的那几片记进已发送表：记多了会让下一拍误以为客户
        端已经有这些值，那批数据就永远补不回来。
        Args: dashboard_id, outgoing。
        """
        topic = topic_of(dashboard_id)
        traceparent = current_traceparent()
        sent = self._sent.setdefault(dashboard_id, {})
        total = 0
        for shard in shards(outgoing, self.options.max_items):
            is_sent = await self.realtime.publish(
                topic=topic, items=shard, traceparent=traceparent
            )
            if not is_sent:
                _logger.warning(
                    "dashboard_frame_dropped",
                    "一批大屏实时值没能推出去，客户端会看到 seq 缺口",
                    dashboard_id=str(dashboard_id),
                    items=len(shard),
                )
                return total
            sent.update(index_by_node_key(shard))
            total += len(shard)
        return total

    async def _plan_of(
        self, dashboard_id: uuid.UUID
    ) -> tuple[DashboardPlan | None, bool]:
        """取一张大屏的绑定计划，返回 (计划, 这一拍是否重读过)。

        Args: dashboard_id。
        """
        lookup = await self.plans.load(
            dashboard_id, self._plans.get(dashboard_id)
        )
        if lookup.plan is None:
            # 大屏没了：主题对账那一支会把它的主题注销掉
            self._forget(dashboard_id)
            return None, False
        self._plans[dashboard_id] = lookup.plan
        return lookup.plan, lookup.is_reloaded

    def _is_new_audience(
        self, dashboard_id: uuid.UUID, connections: frozenset[uuid.UUID]
    ) -> bool:
        """这一拍有没有新观看者。有就推全量。

        ⚠ 比的是连接集合而不是人数：人数不变的换人同样是一位新观看者，而他
        的画面在下一次值变化之前会一直空着。
        Args: dashboard_id, connections。
        """
        return bool(connections - self._watchers.get(dashboard_id, frozenset()))

    def _forget_gone(
        self, watchers: Mapping[uuid.UUID, frozenset[uuid.UUID]]
    ) -> None:
        """没人看了的大屏一律清缓存，进程内状态不随大屏数无限涨。

        Args: watchers。
        """
        for dashboard_id in list(self._watchers):
            if dashboard_id not in watchers:
                self._forget(dashboard_id)

    def _forget(self, dashboard_id: uuid.UUID) -> None:
        self._watchers.pop(dashboard_id, None)
        self._plans.pop(dashboard_id, None)
        self._sent.pop(dashboard_id, None)
