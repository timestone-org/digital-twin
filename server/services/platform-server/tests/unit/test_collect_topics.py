"""采集主题的命名与解析。

⚠ 两条推送链路共住一张订阅表，主题名互相认不出来是**正常状态**：认不出必须
返回 None 而不是抛，否则一条无关主题会掀翻整拍。
"""

import uuid

from platform_server.apps.collect.catalog import COLLECT_VIEW
from platform_server.apps.collect.services.topics import (
    PUBLISHER_NAME,
    TOPIC_REQUIRED_CODE,
    source_id_of,
    topic_of,
)
from platform_server.apps.dashboard.services.topics import (
    PUBLISHER_NAME as DASHBOARD_PUBLISHER,
)
from platform_server.apps.dashboard.services.topics import (
    topic_of as dashboard_topic_of,
)

SOURCE_ID = uuid.UUID("0199a000-0000-7000-8000-000000000001")


def test_the_topic_carries_the_source_id() -> None:
    assert topic_of(SOURCE_ID) == f"collect:{SOURCE_ID}"


def test_a_topic_round_trips_back_to_its_source() -> None:
    assert source_id_of(topic_of(SOURCE_ID)) == SOURCE_ID


def test_another_publishers_topic_is_not_ours() -> None:
    assert source_id_of(dashboard_topic_of(SOURCE_ID)) is None


def test_a_topic_without_a_separator_is_not_ours() -> None:
    assert source_id_of("collect") is None


def test_a_malformed_identifier_is_refused_quietly() -> None:
    # 抛出去的话，订阅表里一条手写的脏主题会让整拍推送停摆
    assert source_id_of("collect:not-a-uuid") is None


def test_subscribing_needs_the_same_code_as_viewing_the_config() -> None:
    # 「能看采集配置」与「能订它的实时值」是同一件事，不该有第二套判据
    assert TOPIC_REQUIRED_CODE == COLLECT_VIEW


def test_the_two_lanes_reconcile_under_different_publisher_names() -> None:
    # ⚠ 同名的话，一方对账会把另一方的主题当成「多出来的」全部注销掉
    assert PUBLISHER_NAME != DASHBOARD_PUBLISHER
