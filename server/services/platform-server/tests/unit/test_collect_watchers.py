"""谁在看哪个数据源：把订阅关系读成活跃集合。

⚠ 同一张订阅表里同时躺着大屏与 opcua-server 的主题，只挑本域那些。
集合的元素是订阅行 id，理由见大屏侧 `test_dashboard_viewers.py`。
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
SUBSCRIPTION_1 = uuid.UUID("0199b000-0000-7000-8000-000000000001")
SUBSCRIPTION_2 = uuid.UUID("0199b000-0000-7000-8000-000000000002")
CONNECTION = uuid.UUID("0199b000-0000-7000-8000-0000000000c1")


async def test_two_subscriptions_on_one_source_land_in_one_set() -> None:
    source = FakeViewerSource(
        rows=[
            subscription_row(topic_of(SOURCE_A), SUBSCRIPTION_1),
            subscription_row(topic_of(SOURCE_A), SUBSCRIPTION_2),
        ]
    )
    active = await SubscriptionWatchers(source=source).active()
    assert active == {SOURCE_A: frozenset({SUBSCRIPTION_1, SUBSCRIPTION_2})}


async def test_each_source_keeps_its_own_subscriptions() -> None:
    source = FakeViewerSource(
        rows=[
            subscription_row(topic_of(SOURCE_A), SUBSCRIPTION_1),
            subscription_row(topic_of(SOURCE_B), SUBSCRIPTION_2),
        ]
    )
    active = await SubscriptionWatchers(source=source).active()
    assert active == {
        SOURCE_A: frozenset({SUBSCRIPTION_1}),
        SOURCE_B: frozenset({SUBSCRIPTION_2}),
    }


async def test_only_collect_topics_are_asked_for() -> None:
    source = FakeViewerSource()
    await SubscriptionWatchers(source=source).active()
    assert source.queries[0][1] == {"topic_prefix": "collect:%"}


def test_a_resubscribe_on_the_same_connection_is_a_new_watcher() -> None:
    # 同一条连接退订又重订：行删了再插、主键换新而连接 id 不变。
    # 集合必须跟着变，否则回到配置页的那位永远等不到全量帧
    before = group_by_source(
        [
            {
                "topic": topic_of(SOURCE_A),
                "id": SUBSCRIPTION_1,
                "connection_id": CONNECTION,
            }
        ]
    )
    after = group_by_source(
        [
            {
                "topic": topic_of(SOURCE_A),
                "id": SUBSCRIPTION_2,
                "connection_id": CONNECTION,
            }
        ]
    )
    assert before[SOURCE_A] != after[SOURCE_A]


def test_another_publishers_topic_is_dropped() -> None:
    # 大屏主题混在同一张表里；把它读成数据源就是给一个不存在的源推值
    rows = [subscription_row(dashboard_topic_of(SOURCE_A), SUBSCRIPTION_1)]
    assert group_by_source(rows) == {}


def test_a_subscription_that_is_not_a_uuid_is_dropped() -> None:
    rows = [{"topic": topic_of(SOURCE_A), "id": "不是 UUID"}]
    assert group_by_source(rows) == {}


def test_a_subscription_given_as_text_still_counts() -> None:
    rows = [{"topic": topic_of(SOURCE_A), "id": str(SUBSCRIPTION_1)}]
    assert group_by_source(rows) == {SOURCE_A: frozenset({SUBSCRIPTION_1})}
