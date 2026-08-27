"""发布一拍的四条口径：只推有人看的、新观看者收全量、增量只推变化、失败不重推。

⚠ 「推失败仍记成已发送」是最难查的一种：下一拍会以为客户端已经有这些值，
那批数据就永远补不回来，而日志里只有一条推送失败。
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from lib.errors import DependencyUnavailable
from platform_server.apps.collect.services import PointReading
from platform_server.apps.collect.services.point_frames import (
    KEY_NODE,
    KEY_STATE,
    KEY_VALUE,
    POINT_STATE_ERROR,
    POINT_STATE_OK,
    UNAVAILABLE_REASON,
)
from platform_server.apps.dashboard.services.publish_plan import (
    DashboardPlan,
    PlanLookup,
)
from platform_server.apps.dashboard.services.publish_service import (
    DashboardPublisher,
    PublishOptions,
)
from platform_server.apps.dashboard.services.topics import topic_of
from platform_server.apps.dashboard.services.viewers import (
    SubscriptionViewers,
)
from unit.publish_fakes import (
    FakeRealtime,
    FakeSnapshotSource,
    FakeViewerSource,
    subscription_row,
)

DASHBOARD = uuid.UUID("0198f0c0-0000-7000-8000-0000000000a1")
OTHER_DASHBOARD = uuid.UUID("0198f0c0-0000-7000-8000-0000000000a2")
# 观看者的身份是**订阅行 id**：退订重订会换新，连接 id 不会（viewers.py）
VIEWER = uuid.UUID("0198f0c0-0000-7000-8000-0000000000b1")
SECOND_VIEWER = uuid.UUID("0198f0c0-0000-7000-8000-0000000000b2")
CONNECTION = uuid.UUID("0198f0c0-0000-7000-8000-0000000000c1")
SOURCE = "0198f0c0-0000-7000-8000-00000000abcd"
OUTLET = f"{SOURCE}:outlet_temp"
INLET = f"{SOURCE}:inlet_temp"
NOW_MS = 1_760_000_000_000
# 一天。用来验「很久没变的值照样是正常值」
A_DAY_MS = 86_400_000


@dataclass
class FakePlanSource:
    """计划面。用例直接给点位与版本，不打库。"""

    plans: dict[uuid.UUID, DashboardPlan] = field(
        default_factory=dict[uuid.UUID, DashboardPlan]
    )
    loads: list[uuid.UUID] = field(default_factory=list[uuid.UUID])
    # 每一拍问了哪一批。批数 = 这一拍开了几个会话
    batches: list[tuple[uuid.UUID, ...]] = field(
        default_factory=list[tuple[uuid.UUID, ...]]
    )

    async def load_many(
        self,
        dashboard_ids: Sequence[uuid.UUID],
        cached: Mapping[uuid.UUID, DashboardPlan],
    ) -> dict[uuid.UUID, PlanLookup]:
        self.batches.append(tuple(dashboard_ids))
        return {
            dashboard_id: self._lookup(dashboard_id, cached.get(dashboard_id))
            for dashboard_id in dashboard_ids
        }

    def _lookup(
        self, dashboard_id: uuid.UUID, cached: DashboardPlan | None
    ) -> PlanLookup:
        self.loads.append(dashboard_id)
        plan = self.plans.get(dashboard_id)
        if plan is None:
            return PlanLookup(plan=None, is_reloaded=False)
        if cached is not None and cached.row_version == plan.row_version:
            return PlanLookup(plan=cached, is_reloaded=False)
        return PlanLookup(plan=plan, is_reloaded=True)


def plan_of(*node_keys: str, row_version: int = 1) -> DashboardPlan:
    """一份计划。

    Args: node_keys, row_version。
    """
    return DashboardPlan(row_version=row_version, node_keys=node_keys)


def reading(value: object, *, age_ms: int = 0) -> PointReading:
    """一条读数。

    Args: value, age_ms。
    """
    return PointReading(
        value=value, timestamp_ms=NOW_MS - age_ms, quality="good"
    )


@dataclass
class Harness:
    """一套装好的发布器与它的四件假件。"""

    publisher: DashboardPublisher
    plans: FakePlanSource
    snapshots: FakeSnapshotSource
    realtime: FakeRealtime
    source: FakeViewerSource

    def watch(self, *pairs: tuple[uuid.UUID, uuid.UUID]) -> None:
        """摆出「谁在看哪张大屏」。

        Args: pairs（大屏, 订阅行 id）。
        """
        self.source.rows = [
            subscription_row(topic_of(dashboard_id), subscription_id)
            for dashboard_id, subscription_id in pairs
        ]

    def frames(self) -> list[list[dict[str, object]]]:
        """推出去的每一批条目。"""
        return [items for _topic, items, _trace in self.realtime.published]

    def node_keys(self) -> list[list[str]]:
        """推出去的每一批里的点位身份。"""
        return [
            [str(item[KEY_NODE]) for item in items] for items in self.frames()
        ]


def build_harness(
    *,
    readings: dict[str, PointReading] | None = None,
    max_items: int = 100,
) -> Harness:
    """装一套发布器。

    Args: readings, max_items。
    """
    plans = FakePlanSource(plans={DASHBOARD: plan_of(OUTLET, INLET)})
    snapshots = FakeSnapshotSource(readings=dict(readings or {}))
    realtime = FakeRealtime()
    source = FakeViewerSource()
    publisher = DashboardPublisher(
        plans=plans,
        viewers=SubscriptionViewers(source=source),
        snapshots=snapshots,
        realtime=realtime,
        options=PublishOptions(max_items=max_items),
    )
    return Harness(
        publisher=publisher,
        plans=plans,
        snapshots=snapshots,
        realtime=realtime,
        source=source,
    )


async def test_a_dashboard_nobody_watches_is_never_pushed() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)})
    report = await harness.publisher.publish_once()
    assert harness.realtime.published == []
    assert report.dashboards == 0


async def test_the_first_frame_carries_every_bound_point() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    assert harness.node_keys() == [[OUTLET, INLET]]
    assert harness.realtime.published[0][0] == topic_of(DASHBOARD)


async def test_the_next_tick_pushes_only_what_changed() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    harness.snapshots.readings[OUTLET] = reading(22.0)
    await harness.publisher.publish_once()
    assert harness.node_keys()[1] == [OUTLET]


async def test_a_tick_with_nothing_new_pushes_nothing() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    report = await harness.publisher.publish_once()
    assert len(harness.frames()) == 1
    assert report.items == 0


async def test_a_new_viewer_gets_a_full_frame_of_its_own() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    harness.watch((DASHBOARD, VIEWER), (DASHBOARD, SECOND_VIEWER))
    await harness.publisher.publish_once()
    assert harness.node_keys() == [[OUTLET, INLET], [OUTLET, INLET]]


async def test_swapping_one_viewer_for_another_still_counts_as_new() -> None:
    # 人数不变的换人：按计数判断会让新来的那位一直空着
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    harness.watch((DASHBOARD, SECOND_VIEWER))
    await harness.publisher.publish_once()
    assert len(harness.frames()) == 2


async def test_a_remount_on_the_same_connection_gets_a_full_frame() -> None:
    """SPA 里从编辑器回到大屏页：同一条连接退订又重订。

    ⚠ 订阅行是删了再插的，主键换新而连接 id 一个字都没变；页面那侧的快照
    缓存已随组件卸载清空。认不出这位观看者的话，值不变的点位永远等不到
    首帧，那一格就一直停在「加载中」——而刷新（换新连接）反而正常。
    """
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.source.rows = [
        {
            "topic": topic_of(DASHBOARD),
            "id": VIEWER,
            "connection_id": CONNECTION,
        }
    ]
    await harness.publisher.publish_once()
    harness.source.rows = [
        {
            "topic": topic_of(DASHBOARD),
            "id": SECOND_VIEWER,
            "connection_id": CONNECTION,
        }
    ]
    await harness.publisher.publish_once()
    assert harness.node_keys() == [[OUTLET, INLET], [OUTLET, INLET]]


async def test_a_changed_binding_plan_forces_a_full_frame() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    harness.plans.plans[DASHBOARD] = plan_of(OUTLET, INLET, row_version=2)
    await harness.publisher.publish_once()
    assert harness.node_keys() == [[OUTLET, INLET], [OUTLET, INLET]]


async def test_a_dashboard_without_realtime_bindings_is_skipped() -> None:
    harness = build_harness()
    harness.plans.plans[DASHBOARD] = plan_of()
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    assert harness.realtime.published == []


async def test_a_deleted_dashboard_is_pushed_nothing_and_forgotten() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    del harness.plans.plans[DASHBOARD]
    await harness.publisher.publish_once()
    assert len(harness.frames()) == 1


async def test_a_point_without_a_snapshot_is_pushed_as_unreadable() -> None:
    harness = build_harness()
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    states = [item[KEY_STATE] for item in harness.frames()[0]]
    assert states == [POINT_STATE_ERROR, POINT_STATE_ERROR]


async def test_a_value_that_has_not_changed_all_day_is_pushed_as_normal() -> (
    None
):
    # 一天才变一次的点位不许因为「时刻旧」被降档：现场没停，只是值没变
    harness = build_harness(readings={OUTLET: reading(21.5, age_ms=A_DAY_MS)})
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    first = harness.frames()[0][0]
    assert first[KEY_STATE] == POINT_STATE_OK
    assert first[KEY_VALUE] == 21.5


async def test_an_unreadable_snapshot_store_is_reported_not_hidden() -> None:
    harness = build_harness()
    harness.snapshots.failure = DependencyUnavailable("Redis 挂了")
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    assert [item[KEY_STATE] for item in harness.frames()[0]] == [
        POINT_STATE_ERROR,
        POINT_STATE_ERROR,
    ]
    assert harness.frames()[0][0]["errorMessage"] == UNAVAILABLE_REASON


async def test_a_dropped_frame_is_pushed_again_next_tick() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    harness.realtime.is_reachable = False
    await harness.publisher.publish_once()
    harness.realtime.is_reachable = True
    await harness.publisher.publish_once()
    assert harness.node_keys()[1] == [OUTLET, INLET]


async def test_an_oversized_frame_is_sharded_by_the_sender() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)}, max_items=1)
    harness.watch((DASHBOARD, VIEWER))
    report = await harness.publisher.publish_once()
    assert harness.node_keys() == [[OUTLET], [INLET]]
    assert report.items == 2


async def test_the_shards_after_a_failed_one_are_not_sent() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)}, max_items=1)
    harness.watch((DASHBOARD, VIEWER))
    harness.realtime.is_reachable = False
    report = await harness.publisher.publish_once()
    assert len(harness.frames()) == 1
    assert report.items == 0


async def test_every_frame_carries_a_traceparent() -> None:
    # ⚠ 少了它，链路在「推送方 → hub → 订阅方」这一跳齐断
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    _topic, _items, traceparent = harness.realtime.published[0]
    assert traceparent is not None
    assert traceparent.startswith("00-")


async def test_two_watched_dashboards_are_pushed_on_their_own_topics() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.plans.plans[OTHER_DASHBOARD] = plan_of(OUTLET)
    harness.watch((DASHBOARD, VIEWER), (OTHER_DASHBOARD, SECOND_VIEWER))
    report = await harness.publisher.publish_once()
    topics = {topic for topic, _items, _trace in harness.realtime.published}
    assert topics == {topic_of(DASHBOARD), topic_of(OTHER_DASHBOARD)}
    assert report.dashboards == 2


async def test_the_snapshot_read_asks_only_for_the_bound_points() -> None:
    # ⚠ 一个数据源下可能挂着上万个点位，一张大屏只绑其中十几个
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    assert harness.snapshots.asked == [(OUTLET, INLET)]


async def test_losing_the_lease_drops_what_we_believed_the_client_had() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    harness.publisher.forget_all()
    await harness.publisher.publish_once()
    assert harness.node_keys() == [[OUTLET, INLET], [OUTLET, INLET]]


async def test_an_unreadable_subscription_table_stops_the_tick() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    harness.source.failure = DependencyUnavailable("订阅表读不了")
    raised: list[str] = []
    try:
        await harness.publisher.publish_once()
    except DependencyUnavailable:
        raised.append("stopped")
    assert raised == ["stopped"]
    assert harness.realtime.published == []


async def test_a_dashboard_left_alone_is_forgotten() -> None:
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    harness.watch()
    await harness.publisher.publish_once()
    harness.watch((DASHBOARD, VIEWER))
    await harness.publisher.publish_once()
    assert harness.node_keys() == [[OUTLET, INLET], [OUTLET, INLET]]


async def test_one_tick_asks_the_plan_source_one_batch() -> None:
    """一拍一批，与在看的屏数无关。

    ⚠ 按屏各问一次的话，真实现那边就是按屏各开一个只读会话——在看的屏有多少
    张，每一拍就有多少次 BEGIN/COMMIT，而绝大多数拍里一张都没变。
    """
    harness = build_harness(readings={OUTLET: reading(21.5)})
    harness.plans.plans[OTHER_DASHBOARD] = plan_of(OUTLET)
    harness.watch((DASHBOARD, VIEWER), (OTHER_DASHBOARD, SECOND_VIEWER))

    await harness.publisher.publish_once()

    assert len(harness.plans.batches) == 1
    assert set(harness.plans.batches[0]) == {DASHBOARD, OTHER_DASHBOARD}


async def test_a_tick_with_nobody_watching_asks_for_an_empty_batch() -> None:
    # ⚠ 空批必须由真实现自己短路掉，不许换成一条 `IN ()` 查询
    harness = build_harness(readings={OUTLET: reading(21.5)})
    await harness.publisher.publish_once()
    assert harness.plans.batches == [()]
