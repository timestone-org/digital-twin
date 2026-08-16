"""守计划到驱动那一步换手：连接参数、点位规格、以及「要不要重连」的判据。

计划本身的形状归 `collectwire`，它自己的用例守着；这里守的是本服务把它翻成
驱动输入时**没有丢东西**。
⚠ 计划是协议无关的：`address` 对本层不透明，只有驱动解析（ADR-0011）。
"""

from collector_server.apps.collect.drivers.base import DriverTimeouts
from collector_server.apps.collect.plan.adapt import (
    specs_of,
    to_connection,
    without_points,
)
from collectwire import CollectPlan

PAYLOAD = {
    "version": "v7",
    "sources": [
        {
            "source_id": "0192f000-0000-7000-8000-000000000001",
            "code": "line-1",
            "protocol": "opcua",
            "endpoint": "opc.tcp://10.0.0.9:4840/line-1",
            "read_mode": "subscribe",
            "poll_interval_ms": 1000,
            "options": {"security_policy": "None"},
            "username": "operator",
            "password": "s3cret",
            "points": [
                {
                    "point_code": "outlet_temp",
                    "address": "ns=2;s=Temp1",
                    "sampling_interval_ms": 1000,
                }
            ],
        }
    ],
}


def test_a_source_translates_into_driver_inputs() -> None:
    source = CollectPlan.model_validate(PAYLOAD).sources[0]
    connection = to_connection(source, DriverTimeouts())
    assert connection.endpoint == "opc.tcp://10.0.0.9:4840/line-1"
    assert connection.username == "operator"
    assert connection.password == "s3cret"
    assert connection.options == {"security_policy": "None"}


def test_a_source_without_credentials_connects_anonymously() -> None:
    """⚠ 解不开或没配就是 None：按匿名连，连不上会以 auth 类错误响亮失败。"""
    payload = {**PAYLOAD["sources"][0], "username": None, "password": None}  # type: ignore[index]  # 契约样本是字面量
    plan = CollectPlan.model_validate({"version": "v7", "sources": [payload]})
    connection = to_connection(plan.sources[0], DriverTimeouts())
    assert (connection.username, connection.password) == (None, None)


def test_the_addressing_string_reaches_the_driver_untouched() -> None:
    """寻址串对本层不透明，翻一道不许做任何归一化。"""
    specs = specs_of(CollectPlan.model_validate(PAYLOAD).sources[0])
    assert [spec.address for spec in specs] == ["ns=2;s=Temp1"]
    assert [spec.point_code for spec in specs] == ["outlet_temp"]
    assert [spec.sampling_interval_ms for spec in specs] == [1000]


def test_the_archive_parameters_do_not_travel_to_the_driver() -> None:
    """归档三件套归管道，驱动不认识它们（ADR-0011 的缝在 ValueSink 上）。"""
    spec = specs_of(CollectPlan.model_validate(PAYLOAD).sources[0])[0]
    assert not hasattr(spec, "archive_enabled")


def test_a_source_with_no_points_yields_no_specs() -> None:
    payload = {**PAYLOAD["sources"][0], "points": []}  # type: ignore[index]  # 契约样本是字面量
    plan = CollectPlan.model_validate({"version": "v7", "sources": [payload]})
    assert specs_of(plan.sources[0]) == ()


def test_changing_only_points_leaves_the_connection_identity_equal() -> None:
    """⚠ 只加一个点位就断整台设备的会话，等于每次保存配置都停采几秒。"""
    plan = CollectPlan.model_validate(PAYLOAD)
    grown = plan.sources[0].model_copy(update={"points": ()})
    assert without_points(grown) == without_points(plan.sources[0])


def test_changing_the_endpoint_does_change_the_connection_identity() -> None:
    plan = CollectPlan.model_validate(PAYLOAD)
    moved = plan.sources[0].model_copy(update={"endpoint": "opc.tcp://other"})
    assert without_points(moved) != without_points(plan.sources[0])
