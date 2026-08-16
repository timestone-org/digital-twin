"""谁在看哪个数据源：把订阅关系读成活跃集合。

⚠ 同一张订阅表里同时躺着大屏与 opcua-server 的主题，只挑本域那些。
"""

import uuid

from platform_server.apps.collect.services.topics import topic_of
from platform_server.apps.collect.services.watchers import (
    SubscriptionWatchers,
    group_by_source,
)
from platform_server.apps.dashboard.services.topics import (
    topic_of as dashboard_topic_of,
)
from unit.publish_fakes import FakeViewerSource, subscription_row

SOURCE_A = uuid.UUID("0199a000-0000-7000-8000-00000000000a")
SOURCE_B = uuid.UUID("0199a000-0000-7000-8000-00000000000b")
CONNECTION_1 = uuid.UUID("0199b000-0000-7000-8000-000000000001")
CONNECTION_2 = uuid.UUID("0199b000-0000-7000-8000-000000000002")


async def test_two_connections_on_one_source_land_in_one_set() -> None:
    source = FakeViewerSource(
        rows=[
            subscription_row(topic_of(SOURCE_A), CONNECTION_1),
            subscription_row(topic_of(SOURCE_A), CONNECTION_2),
        ]
    )
    active = await SubscriptionWatchers(source=source).active()
    assert active == {SOURCE_A: frozenset({CONNECTION_1, CONNECTION_2})}


async def test_each_source_keeps_its_own_connections() -> None:
    source = FakeViewerSource(
        rows=[
            subscription_row(topic_of(SOURCE_A), CONNECTION_1),
            subscription_row(topic_of(SOURCE_B), CONNECTION_2),
        ]
    )
    active = await SubscriptionWatchers(source=source).active()
    assert active == {
        SOURCE_A: frozenset({CONNECTION_1}),
        SOURCE_B: frozenset({CONNECTION_2}),
    }


async def test_only_collect_topics_are_asked_for() -> None:
    source = FakeViewerSource()
    await SubscriptionWatchers(source=source).active()
    assert source.queries[0][1] == {"topic_prefix": "collect:%"}


def test_another_publishers_topic_is_dropped() -> None:
    # 大屏主题混在同一张表里；把它读成数据源就是给一个不存在的源推值
    rows = [subscription_row(dashboard_topic_of(SOURCE_A), CONNECTION_1)]
    assert group_by_source(rows) == {}


def test_a_connection_that_is_not_a_uuid_is_dropped() -> None:
    rows = [{"topic": topic_of(SOURCE_A), "connection_id": "不是 UUID"}]
    assert group_by_source(rows) == {}


def test_a_connection_given_as_text_still_counts() -> None:
    rows = [{"topic": topic_of(SOURCE_A), "connection_id": str(CONNECTION_1)}]
    assert group_by_source(rows) == {SOURCE_A: frozenset({CONNECTION_1})}
