"""采集配置页那条推送链路的口径。

四条必须钉死：只推有人在看的、新观看者收全量、清单变了收全量、快照读不到
整批标成取不到。少任何一条，配置页上「有值 / 没值 / 值是旧的」就分不开。
"""

import uuid
from dataclasses import dataclass

from lib.errors import DependencyUnavailable
from platform_server.apps.collect.services.live_plan import LivePlan
from platform_server.apps.collect.services.live_publisher import (
    LiveOptions,
    SourceLivePublisher,
)
from platform_server.apps.collect.services.snapshot_source import PointReading
from platform_server.apps.collect.services.topics import topic_of
from platform_server.apps.collect.services.watchers import SubscriptionWatchers
from unit.publish_fakes import (
    FakeRealtime,
    FakeSnapshotSource,
    FakeViewerSource,
    subscription_row,
)

SOURCE_ID = uuid.UUID("0199a000-0000-7000-8000-00000000000a")
CONNECTION_1 = uuid.UUID("0199b000-0000-7000-8000-000000000001")
CONNECTION_2 = uuid.UUID("0199b000-0000-7000-8000-000000000002")
KEY_A = f"{SOURCE_ID}:temp"
KEY_B = f"{SOURCE_ID}:flow"
NOW_MS = 1_700_000_000_000
STALE_AFTER_MS = 15_000


@dataclass
class FakeLivePlanSource:
    """点位清单查询。用例直接给清单，不打库。"""

    plan: LivePlan | None = None
    calls: int = 0

    async def load(
        self, source_id: uuid.UUID, *, limit: int
    ) -> LivePlan | None:
        del source_id, limit
        self.calls += 1
        return self.plan


@dataclass
class FakeTicker:
    """可拨的单调时钟，秒。"""

    now_s: float = 0.0

    def __call__(self) -> float:
        return self.now_s


@dataclass
class Harness:
    """一套装好的发布器与它的假件。"""

    publisher: SourceLivePublisher
    plans: FakeLivePlanSource
    snapshots: FakeSnapshotSource
    realtime: FakeRealtime
    viewers: FakeViewerSource
    ticker: FakeTicker


def reading(value: object, *, at_ms: int = NOW_MS) -> PointReading:
    """一条好读数。

    Args: value, at_ms。
    """
    return PointReading(value=value, timestamp_ms=at_ms, quality="good")


def build_harness(
    *,
    node_keys: tuple[str, ...] = (KEY_A, KEY_B),
    connections: tuple[uuid.UUID, ...] = (CONNECTION_1,),
    max_items: int = 200,
    plan_ttl_s: float = 10.0,
) -> Harness:
    """装一套发布器。

    Args: node_keys, connections, max_items, plan_ttl_s。
    """
    snapshots = FakeSnapshotSource(
        readings={key: reading(1.0) for key in node_keys}
    )
    plans = FakeLivePlanSource(
        plan=LivePlan(node_keys=node_keys, is_truncated=False)
    )
    viewers = FakeViewerSource(
        rows=[
            subscription_row(topic_of(SOURCE_ID), connection)
            for connection in connections
        ]
    )
    realtime = FakeRealtime()
    ticker = FakeTicker()
    publisher = SourceLivePublisher(
        plans=plans,
        watchers=SubscriptionWatchers(source=viewers),
        snapshots=snapshots,
        realtime=realtime,
        options=LiveOptions(
            max_items=max_items,
            stale_after_ms=STALE_AFTER_MS,
            max_points=1000,
            plan_ttl_s=plan_ttl_s,
        ),
        clock=lambda: NOW_MS,
        ticker=ticker,
    )
    return Harness(
        publisher=publisher,
        plans=plans,
        snapshots=snapshots,
        realtime=realtime,
        viewers=viewers,
        ticker=ticker,
    )


async def test_nobody_watching_means_nothing_is_pushed() -> None:
    harness = build_harness(connections=())
    report = await harness.publisher.publish_once()
    assert (report.sources, report.items) == (0, 0)
    assert harness.realtime.published == []


async def test_a_new_watcher_gets_the_whole_list_at_once() -> None:
    # hub 不会凭空补当前值：不推全量，页面会一直空着到某个值恰好变化
    harness = build_harness()
    await harness.publisher.publish_once()
    topic, items, _ = harness.realtime.published[0]
    assert topic == topic_of(SOURCE_ID)
    assert {item["nodeKey"] for item in items} == {KEY_A, KEY_B}


async def test_an_unchanged_second_tick_pushes_nothing() -> None:
    harness = build_harness()
    await harness.publisher.publish_once()
    await harness.publisher.publish_once()
    assert len(harness.realtime.published) == 1


async def test_only_the_changed_point_goes_out_on_the_next_tick() -> None:
    harness = build_harness()
    await harness.publisher.publish_once()
    harness.snapshots.readings[KEY_A] = reading(2.0)
    await harness.publisher.publish_once()
    _, items, _ = harness.realtime.published[1]
    assert [item["nodeKey"] for item in items] == [KEY_A]


async def test_a_second_watcher_gets_a_full_frame_too() -> None:
    harness = build_harness()
    await harness.publisher.publish_once()
    harness.viewers.rows.append(
        subscription_row(topic_of(SOURCE_ID), CONNECTION_2)
    )
    await harness.publisher.publish_once()
    _, items, _ = harness.realtime.published[1]
    assert len(items) == 2


async def test_a_new_point_arrives_as_a_full_frame() -> None:
    harness = build_harness(node_keys=(KEY_A,), plan_ttl_s=0.0)
    await harness.publisher.publish_once()
    harness.plans.plan = LivePlan(node_keys=(KEY_A, KEY_B), is_truncated=False)
    harness.snapshots.readings[KEY_B] = reading(3.0)
    await harness.publisher.publish_once()
    _, items, _ = harness.realtime.published[1]
    assert {item["nodeKey"] for item in items} == {KEY_A, KEY_B}


async def test_the_list_is_not_reread_before_its_ttl() -> None:
    # 每拍重读一次上万行的点位表，一台设备就能把库压住
    harness = build_harness(plan_ttl_s=10.0)
    await harness.publisher.publish_once()
    await harness.publisher.publish_once()
    assert harness.plans.calls == 1


async def test_the_list_is_reread_once_the_ttl_is_up() -> None:
    harness = build_harness(plan_ttl_s=10.0)
    await harness.publisher.publish_once()
    harness.ticker.now_s = 10.0
    await harness.publisher.publish_once()
    assert harness.plans.calls == 2


async def test_rereading_an_unchanged_list_does_not_repush_everything() -> None:
    # ⚠ 到期重读不等于清单变了：不比对就每个 TTL 重推一遍全量
    harness = build_harness(plan_ttl_s=10.0)
    await harness.publisher.publish_once()
    harness.ticker.now_s = 10.0
    await harness.publisher.publish_once()
    assert len(harness.realtime.published) == 1


async def test_a_deleted_source_stops_being_pushed() -> None:
    harness = build_harness(plan_ttl_s=0.0)
    harness.plans.plan = None
    await harness.publisher.publish_once()
    assert harness.realtime.published == []


async def test_an_unreadable_snapshot_marks_the_whole_batch_as_missing() -> (
    None
):
    # 静默不推的话，页面上一批旧值会一直挂着，看不出采集已经断了
    harness = build_harness()
    harness.snapshots.failure = DependencyUnavailable("Redis 不可达")
    await harness.publisher.publish_once()
    _, items, _ = harness.realtime.published[0]
    assert {item["state"] for item in items} == {"error"}


async def test_a_dropped_shard_is_not_recorded_as_sent() -> None:
    # 记多了，下一拍会以为客户端已经有这些值，那批数据就永远补不回来
    harness = build_harness()
    harness.realtime.is_reachable = False
    await harness.publisher.publish_once()
    harness.realtime.is_reachable = True
    await harness.publisher.publish_once()
    _, items, _ = harness.realtime.published[1]
    assert len(items) == 2


async def test_a_long_list_is_sharded_by_the_publisher() -> None:
    # hub 超限直接 413 且不替谁拆
    harness = build_harness(max_items=1)
    await harness.publisher.publish_once()
    assert [len(items) for _, items, _ in harness.realtime.published] == [1, 1]


async def test_losing_the_lease_forces_a_full_frame_next_time() -> None:
    harness = build_harness()
    await harness.publisher.publish_once()
    harness.publisher.forget_all()
    await harness.publisher.publish_once()
    _, items, _ = harness.realtime.published[1]
    assert len(items) == 2
