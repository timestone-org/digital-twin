"""活跃大屏由 hub 的订阅关系推导，且只按前缀取本域的主题。

⚠ 集合的元素是**订阅行 id**而不是连接 id 或计数：退订即删行、重订即插新行，
同一条连接在 SPA 里切页面回来（本地快照已清空）只有行 id 认得出来；按连接
比对的话，全量帧永远欠着，页面停在「加载中」（DASHBOARD_DESIGN §6.1）。
"""

import uuid

from platform_server.apps.dashboard.services.topics import topic_of
from platform_server.apps.dashboard.services.viewers import (
    SUBSCRIPTION_TABLE,
    SubscriptionViewers,
    group_by_dashboard,
)
from unit.publish_fakes import FakeViewerSource, subscription_row

FIRST_DASHBOARD = uuid.UUID("0198f0c0-0000-7000-8000-0000000000a1")
SECOND_DASHBOARD = uuid.UUID("0198f0c0-0000-7000-8000-0000000000a2")
FIRST_SUBSCRIPTION = uuid.UUID("0198f0c0-0000-7000-8000-0000000000b1")
SECOND_SUBSCRIPTION = uuid.UUID("0198f0c0-0000-7000-8000-0000000000b2")
THIRD_SUBSCRIPTION = uuid.UUID("0198f0c0-0000-7000-8000-0000000000b3")
CONNECTION = uuid.UUID("0198f0c0-0000-7000-8000-0000000000c1")


async def test_the_active_set_lists_every_subscription_on_a_dashboard() -> None:
    source = FakeViewerSource(
        rows=[
            subscription_row(topic_of(FIRST_DASHBOARD), FIRST_SUBSCRIPTION),
            subscription_row(topic_of(FIRST_DASHBOARD), SECOND_SUBSCRIPTION),
            subscription_row(topic_of(SECOND_DASHBOARD), THIRD_SUBSCRIPTION),
        ]
    )
    active = await SubscriptionViewers(source=source).active()
    assert active == {
        FIRST_DASHBOARD: frozenset({FIRST_SUBSCRIPTION, SECOND_SUBSCRIPTION}),
        SECOND_DASHBOARD: frozenset({THIRD_SUBSCRIPTION}),
    }


async def test_nobody_watching_gives_an_empty_active_set() -> None:
    active = await SubscriptionViewers(source=FakeViewerSource()).active()
    assert active == {}


async def test_the_query_reads_only_the_hub_table_with_a_bound_prefix() -> None:
    source = FakeViewerSource()
    await SubscriptionViewers(source=source).active()
    sql, params = source.queries[0]
    assert SUBSCRIPTION_TABLE in sql
    assert "JOIN" not in sql.upper()
    assert params == {"topic_prefix": "dashboard:%"}


def test_a_resubscribe_on_the_same_connection_is_a_new_audience() -> None:
    # SPA 里从编辑器回到大屏页：同一条连接退订又重订，行是删了再插的，
    # 主键必然换新，而连接 id 一个字都没变。集合必须跟着变，发布循环才
    # 认得出「这是一位刚清空了本地快照的观看者」，否则那一格永远「加载中」
    before = group_by_dashboard(
        [
            {
                "topic": topic_of(FIRST_DASHBOARD),
                "id": FIRST_SUBSCRIPTION,
                "connection_id": CONNECTION,
            }
        ]
    )
    after = group_by_dashboard(
        [
            {
                "topic": topic_of(FIRST_DASHBOARD),
                "id": SECOND_SUBSCRIPTION,
                "connection_id": CONNECTION,
            }
        ]
    )
    assert before[FIRST_DASHBOARD] != after[FIRST_DASHBOARD]


def test_another_publishers_topics_are_not_counted_as_viewers() -> None:
    rows = [
        subscription_row(f"opcua:{uuid.uuid4()}", FIRST_SUBSCRIPTION),
        subscription_row(topic_of(FIRST_DASHBOARD), SECOND_SUBSCRIPTION),
    ]
    assert group_by_dashboard(rows) == {
        FIRST_DASHBOARD: frozenset({SECOND_SUBSCRIPTION})
    }


def test_a_subscription_identifier_given_as_text_is_still_a_viewer() -> None:
    # 驱动按列类型回 UUID，但只读查询走的是 text()，两种形态都要认
    rows = [
        {
            "topic": topic_of(FIRST_DASHBOARD),
            "id": str(FIRST_SUBSCRIPTION),
        }
    ]
    assert group_by_dashboard(rows) == {
        FIRST_DASHBOARD: frozenset({FIRST_SUBSCRIPTION})
    }


def test_a_row_whose_identifier_is_not_a_uuid_is_dropped() -> None:
    rows = [
        {"topic": topic_of(FIRST_DASHBOARD), "id": "not-a-uuid"},
        {"topic": topic_of(FIRST_DASHBOARD), "id": None},
    ]
    assert group_by_dashboard(rows) == {}


def test_a_row_without_a_topic_is_dropped() -> None:
    assert group_by_dashboard([{"id": FIRST_SUBSCRIPTION}]) == {}
