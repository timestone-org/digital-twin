"""主题对账：大屏表是权威，hub 那份清单是投影。

⚠ 取不到 hub 的清单时**一个都不注销**：输入为空意味着「我没看见任何主题」，
按它去清就会把全量主题清光，而那会让每一张大屏都收不到实时值。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field

from platform_server.apps.dashboard.catalog import DASHBOARD_VIEW
from platform_server.apps.dashboard.services import TopicReconciler
from platform_server.apps.dashboard.services.topics import (
    PUBLISHER_NAME,
    topic_of,
)
from unit.publish_fakes import FakeRealtime

FIRST = uuid.UUID("0198f0c0-0000-7000-8000-0000000000a1")
SECOND = uuid.UUID("0198f0c0-0000-7000-8000-0000000000a2")


@dataclass
class FakeDashboardIndex:
    """只回答「库里有哪些大屏」的假件。"""

    ids: list[uuid.UUID] = field(default_factory=list[uuid.UUID])

    async def live_ids(self) -> list[uuid.UUID]:
        return list(self.ids)


def build_reconciler(
    dashboards: Sequence[uuid.UUID], realtime: FakeRealtime
) -> TopicReconciler:
    """装一个对账器，库那一侧换成固定名单。

    Args: dashboards, realtime。
    """
    return TopicReconciler(
        dashboards=FakeDashboardIndex(list(dashboards)), realtime=realtime
    )


async def test_a_dashboard_without_a_topic_gets_one_declared() -> None:
    realtime = FakeRealtime()
    declared, revoked = await build_reconciler([FIRST], realtime).reconcile()
    assert realtime.declared == [
        (topic_of(FIRST), DASHBOARD_VIEW, PUBLISHER_NAME)
    ]
    assert (declared, revoked) == (1, 0)


async def test_a_topic_whose_dashboard_is_gone_is_revoked() -> None:
    realtime = FakeRealtime(known_topics=[topic_of(FIRST), topic_of(SECOND)])
    declared, revoked = await build_reconciler([FIRST], realtime).reconcile()
    assert realtime.revoked == [topic_of(SECOND)]
    assert (declared, revoked) == (0, 1)


async def test_an_already_declared_topic_is_left_alone() -> None:
    realtime = FakeRealtime(known_topics=[topic_of(FIRST)])
    declared, revoked = await build_reconciler([FIRST], realtime).reconcile()
    assert realtime.declared == []
    assert (declared, revoked) == (0, 0)


async def test_an_unreachable_hub_revokes_nothing() -> None:
    realtime = FakeRealtime(known_topics=[topic_of(SECOND)], is_reachable=False)
    declared, revoked = await build_reconciler([FIRST], realtime).reconcile()
    assert realtime.revoked == []
    assert (declared, revoked) == (0, 0)


async def test_a_failed_declare_is_not_counted_as_declared() -> None:
    # 计数是对账的唯一可观测量，多算一次就等于把失败记成成功
    realtime = FakeRealtime(is_reachable=False)
    declared, _revoked = await build_reconciler([FIRST], realtime).reconcile()
    assert realtime.declared == [
        (topic_of(FIRST), DASHBOARD_VIEW, PUBLISHER_NAME)
    ]
    assert declared == 0
