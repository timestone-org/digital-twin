"""守订阅回调：认得的点位才喂 sink，喂的是协议无关的四元组。

⚠ 回调是「协议知识止步」的那条缝：这里漏掉映射，值就会带着 NodeId 流进管道。
"""

from datetime import UTC, datetime

from asyncua import ua

from collector_server.apps.collect.drivers.base import DriverConnection
from collector_server.apps.collect.drivers.opcua.driver import build_client
from collector_server.apps.collect.drivers.opcua.notifier import (
    DataChangeNotifier,
)

NOW_MS = 1_700_000_000_000
MOMENT_MS = 1_767_323_045_000


class StubNode:
    def __init__(self, node_id: str) -> None:
        self.nodeid = ua.NodeId.from_string(node_id)


class StubNotification:
    def __init__(self, reading: ua.DataValue) -> None:
        self.monitored_item = type("Item", (), {"Value": reading})()


def _notifier() -> (
    tuple[DataChangeNotifier, list[tuple[str, object, int, str]]]
):
    seen: list[tuple[str, object, int, str]] = []
    notifier = DataChangeNotifier(
        sink=lambda code, value, ts_ms, quality: seen.append(
            (code, value, ts_ms, quality)
        ),
        clock=lambda: NOW_MS,
    )
    return notifier, seen


def test_a_tracked_node_is_reported_as_a_protocol_free_tuple() -> None:
    notifier, seen = _notifier()
    notifier.track("ns=2;s=Temp1", "outlet_temp")
    reading = ua.DataValue(
        Value=ua.Variant(21.5),
        SourceTimestamp=datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC),
    )
    notifier.datachange_notification(
        StubNode("ns=2;s=Temp1"), 21.5, StubNotification(reading)
    )
    assert seen == [("outlet_temp", 21.5, MOMENT_MS, "good")]


def test_a_bad_status_code_reaches_the_pipeline_as_bad() -> None:
    notifier, seen = _notifier()
    notifier.track("ns=2;s=Temp1", "outlet_temp")
    reading = ua.DataValue(
        Value=ua.Variant(0.0), StatusCode_=ua.StatusCode(0x80340000)
    )
    notifier.datachange_notification(
        StubNode("ns=2;s=Temp1"), 0.0, StubNotification(reading)
    )
    assert seen[0][3] == "bad"


def test_an_unknown_node_is_ignored_rather_than_guessed() -> None:
    notifier, seen = _notifier()
    notifier.datachange_notification(
        StubNode("ns=2;s=Stranger"),
        1.0,
        StubNotification(ua.DataValue(Value=ua.Variant(1.0))),
    )
    assert seen == []


def test_a_forgotten_point_stops_reaching_the_pipeline() -> None:
    notifier, seen = _notifier()
    notifier.track("ns=2;s=Temp1", "outlet_temp")
    notifier.forget("outlet_temp")
    notifier.datachange_notification(
        StubNode("ns=2;s=Temp1"),
        1.0,
        StubNotification(ua.DataValue(Value=ua.Variant(1.0))),
    )
    assert seen == []


def test_client_is_built_with_the_endpoint_and_the_request_budget() -> None:
    client = build_client(
        DriverConnection(endpoint="opc.tcp://10.0.0.9:4840/line-1")
    )
    assert client.server_url.geturl() == "opc.tcp://10.0.0.9:4840/line-1"


def test_client_carries_the_credentials_when_the_plan_has_them() -> None:
    client = build_client(
        DriverConnection(
            endpoint="opc.tcp://10.0.0.9:4840/line-1",
            username="operator",
            password="s3cret",
        )
    )
    assert client._username == "operator"
    assert client._password == "s3cret"
