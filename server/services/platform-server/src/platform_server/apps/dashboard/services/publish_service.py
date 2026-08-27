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
from collections.abc import Mapping
from dataclasses import dataclass, field

from lib.errors import DependencyUnavailable
from lib.logging import current_traceparent, get_logger
from platform_server.apps.collect.services import SnapshotSource
from platform_server.apps.collect.services.point_frames import (
    UNAVAILABLE_REASON,
    Item,
    build_items,
    changed_items,
    error_items,
    index_by_node_key,
    shards,
)
from platform_server.apps.dashboard.services.publish_plan import (
    DashboardPlan,
    PlanLookup,
    PlanSource,
)
from platform_server.apps.dashboard.services.topics import topic_of
from platform_server.apps.dashboard.services.viewers import SubscriptionViewers
from platform_server.realtime import FramePublisher

_logger = get_logger("platform.dashboard.publish")


@dataclass(frozen=True)
class PublishOptions:
    """一拍的节流参数。窗口本身归调用方的循环。"""

    max_items: int


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
        # ⚠ 整批问一次计划：按屏逐个问的话，在看的屏有多少张，每一拍就有多少
        # 个只读会话与多少次 BEGIN/COMMIT
        lookups = await self.plans.load_many(tuple(watchers), self._plans)
        total = 0
        for dashboard_id, subscriptions in watchers.items():
            is_full = self._is_new_audience(dashboard_id, subscriptions)
            total += await self._publish_one(
                dashboard_id, lookups.get(dashboard_id), is_full=is_full
            )
            self._watchers[dashboard_id] = subscriptions
        return PublishReport(dashboards=len(watchers), items=total)

    def forget_all(self) -> None:
        """丢掉全部进程内缓存。丢主时用：接任者会从全量帧重新开始。"""
        self._watchers.clear()
        self._plans.clear()
        self._sent.clear()

    async def _publish_one(
        self,
        dashboard_id: uuid.UUID,
        lookup: PlanLookup | None,
        *,
        is_full: bool,
    ) -> int:
        """推一张大屏，返回真正推出去的条目数。

        Args: dashboard_id, lookup（整批查询里属于它的那一条）, is_full。
        """
        plan, is_reloaded = self._plan_of(dashboard_id, lookup)
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
        return build_items(plan.node_keys, readings)

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

    def _plan_of(
        self, dashboard_id: uuid.UUID, lookup: PlanLookup | None
    ) -> tuple[DashboardPlan | None, bool]:
        """认一张大屏这一拍的计划，返回 (计划, 这一拍是否重读过)。

        Args: dashboard_id, lookup（查不到这一条就当这张大屏已经没了）。
        """
        if lookup is None or lookup.plan is None:
            # 大屏没了：主题对账那一支会把它的主题注销掉
            self._forget(dashboard_id)
            return None, False
        self._plans[dashboard_id] = lookup.plan
        return lookup.plan, lookup.is_reloaded

    def _is_new_audience(
        self, dashboard_id: uuid.UUID, subscriptions: frozenset[uuid.UUID]
    ) -> bool:
        """这一拍有没有新观看者。有就推全量。

        ⚠ 比的是**订阅行 id** 的集合，不是人数也不是连接 id：人数不变的换人、
        以及同一条连接退订又重订（SPA 切页面，本地快照已清空），都是一位
        新观看者，而后者在连接 id 上看不出来——他的画面在下一次值变化之前
        会一直空着。
        Args: dashboard_id, subscriptions。
        """
        return bool(
            subscriptions - self._watchers.get(dashboard_id, frozenset())
        )

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
