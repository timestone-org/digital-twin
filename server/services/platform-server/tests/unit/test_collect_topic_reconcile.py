"""采集主题对账：补齐缺的、注销多的，且只动自己名下那些。

⚠ 主题未登记时 hub 一律拒订，缺一个的表现是「那一页永远没有实时值」，而页面
本身一切正常——这正是必须有一条对账的理由（ADR-0007）。
"""

import uuid
from dataclasses import dataclass, field

from platform_server.apps.collect.catalog import COLLECT_VIEW
from platform_server.apps.collect.services.topic_reconcile import (
    CollectTopicReconciler,
)
from platform_server.apps.collect.services.topics import (
    PUBLISHER_NAME,
    topic_of,
)
from unit.publish_fakes import FakeRealtime

SOURCE_A = uuid.UUID("0199a000-0000-7000-8000-00000000000a")
SOURCE_B = uuid.UUID("0199a000-0000-7000-8000-00000000000b")


@dataclass
class FakeSourceIndex:
    """数据源清单。用例直接给 id。"""

    ids: list[uuid.UUID] = field(default_factory=list[uuid.UUID])

    async def live_ids(self) -> list[uuid.UUID]:
        return list(self.ids)


def build(
    *, ids: list[uuid.UUID], known: list[str], is_reachable: bool = True
) -> tuple[CollectTopicReconciler, FakeRealtime]:
    """装一套对账器。

    Args: ids, known, is_reachable。
    """
    realtime = FakeRealtime(known_topics=list(known), is_reachable=is_reachable)
    reconciler = CollectTopicReconciler(
        sources=FakeSourceIndex(ids=ids), realtime=realtime
    )
    return reconciler, realtime


async def test_a_new_source_gets_its_topic_declared() -> None:
    reconciler, realtime = build(ids=[SOURCE_A], known=[])
    declared, _ = await reconciler.reconcile()
    assert declared == 1
    assert realtime.declared == [
        (topic_of(SOURCE_A), COLLECT_VIEW, PUBLISHER_NAME)
    ]


async def test_an_already_declared_topic_is_left_alone() -> None:
    reconciler, realtime = build(ids=[SOURCE_A], known=[topic_of(SOURCE_A)])
    declared, revoked = await reconciler.reconcile()
    assert (declared, revoked) == (0, 0)
    assert realtime.declared == []


async def test_a_deleted_source_has_its_topic_revoked() -> None:
    reconciler, realtime = build(ids=[SOURCE_A], known=[topic_of(SOURCE_B)])
    _, revoked = await reconciler.reconcile()
    assert revoked == 1
    assert realtime.revoked == [topic_of(SOURCE_B)]


async def test_an_unreachable_hub_revokes_nothing() -> None:
    # ⚠ 取不到清单时输入为空：宁可多留一个空主题，也不要一次超时把全量清光
    reconciler, realtime = build(
        ids=[SOURCE_A], known=[topic_of(SOURCE_B)], is_reachable=False
    )
    _, revoked = await reconciler.reconcile()
    assert (revoked, realtime.revoked) == (0, [])


async def test_a_disabled_source_still_keeps_its_topic() -> None:
    # 停用的数据源照样要能打开配置页看它「为什么没有值」；清单不按启用态过滤，
    # 故对账拿到什么就登记什么
    reconciler, _ = build(ids=[SOURCE_A, SOURCE_B], known=[])
    declared, _ = await reconciler.reconcile()
    assert declared == 2
