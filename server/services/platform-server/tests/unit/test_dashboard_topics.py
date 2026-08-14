"""主题名的口径：`dashboard:{id}`，且认不出的主题一律返回 None 不抛。

⚠ 订阅表里同时躺着别的推送方的主题，逐条抛异常会让一条无关主题掀翻整拍。
"""

import uuid

from platform_server.apps.dashboard.catalog import DASHBOARD_VIEW
from platform_server.apps.dashboard.services.topics import (
    PUBLISHER_NAME,
    TOPIC_REQUIRED_CODE,
    dashboard_id_of,
    topic_of,
)


def test_the_topic_is_the_domain_and_the_dashboard_id() -> None:
    dashboard_id = uuid.UUID("0198f0c0-0000-7000-8000-0000000000aa")
    assert topic_of(dashboard_id) == (
        "dashboard:0198f0c0-0000-7000-8000-0000000000aa"
    )


def test_a_topic_parses_back_to_the_dashboard_it_names() -> None:
    dashboard_id = uuid.uuid4()
    assert dashboard_id_of(topic_of(dashboard_id)) == dashboard_id


def test_another_publishers_topic_is_not_read_as_a_dashboard() -> None:
    assert dashboard_id_of(f"opcua:{uuid.uuid4()}") is None


def test_a_topic_without_a_separator_is_not_read_as_a_dashboard() -> None:
    assert dashboard_id_of("dashboard") is None


def test_a_topic_whose_identifier_is_not_a_uuid_is_rejected() -> None:
    assert dashboard_id_of("dashboard:not-a-uuid") is None


def test_subscribing_requires_the_same_code_as_viewing() -> None:
    # 「能看这张大屏」与「能订它的实时值」是同一件事，不该有第二套判据
    assert TOPIC_REQUIRED_CODE == DASHBOARD_VIEW


def test_the_publisher_name_is_the_deployment_unit_that_pushes() -> None:
    # 对账按这个名字向 hub 要「我名下的主题」，写歪就会清空别人的主题
    assert PUBLISHER_NAME == "platform-publisher"
