"""活跃大屏由 hub 的订阅关系推导，且只按前缀取本域的主题。

⚠ 返回的是连接集合而不是计数：人数不变的换人也必须被认成新观看者，否则新来
的那位在下一次值变化之前一直空着（DASHBOARD_DESIGN §6.1）。
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
FIRST_CONNECTION = uuid.UUID("0198f0c0-0000-7000-8000-0000000000b1")
SECOND_CONNECTION = uuid.UUID("0198f0c0-0000-7000-8000-0000000000b2")


async def test_the_active_set_lists_every_connection_watching_a_dashboard() -> (
    None
):
    source = FakeViewerSource(
        rows=[
            subscription_row(topic_of(FIRST_DASHBOARD), FIRST_CONNECTION),
            subscription_row(topic_of(FIRST_DASHBOARD), SECOND_CONNECTION),
            subscription_row(topic_of(SECOND_DASHBOARD), FIRST_CONNECTION),
        ]
    )
    active = await SubscriptionViewers(source=source).active()
    assert active == {
        FIRST_DASHBOARD: frozenset({FIRST_CONNECTION, SECOND_CONNECTION}),
        SECOND_DASHBOARD: frozenset({FIRST_CONNECTION}),
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


def test_another_publishers_topics_are_not_counted_as_viewers() -> None:
    rows = [
        subscription_row(f"opcua:{uuid.uuid4()}", FIRST_CONNECTION),
        subscription_row(topic_of(FIRST_DASHBOARD), FIRST_CONNECTION),
    ]
    assert group_by_dashboard(rows) == {
        FIRST_DASHBOARD: frozenset({FIRST_CONNECTION})
    }


def test_a_connection_identifier_given_as_text_is_still_a_viewer() -> None:
    # 驱动按列类型回 UUID，但只读查询走的是 text()，两种形态都要认
    rows = [
        {
            "topic": topic_of(FIRST_DASHBOARD),
            "connection_id": str(FIRST_CONNECTION),
        }
    ]
    assert group_by_dashboard(rows) == {
        FIRST_DASHBOARD: frozenset({FIRST_CONNECTION})
    }


def test_a_row_whose_connection_is_not_an_identifier_is_dropped() -> None:
    rows = [
        {"topic": topic_of(FIRST_DASHBOARD), "connection_id": "not-a-uuid"},
        {"topic": topic_of(FIRST_DASHBOARD), "connection_id": None},
    ]
    assert group_by_dashboard(rows) == {}


def test_a_row_without_a_topic_is_dropped() -> None:
    assert group_by_dashboard([{"connection_id": FIRST_CONNECTION}]) == {}
