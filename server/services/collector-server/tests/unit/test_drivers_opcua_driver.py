"""守 OPC UA 驱动的装配口径：解析、分组、句柄合并、读数逐位对齐、浏览成树。

⚠ 这些是「值离开驱动之前」的最后一道加工，配错位不会报错，只会把值写到
别的点位上（COLLECT_DESIGN.md §4.1）。
"""

import asyncio

import pytest
from asyncua import ua

from collector_server.apps.collect.drivers.base import (
    DriverConnection,
    DriverNotConnected,
    PointNotLoaded,
    PointSpec,
)
from collector_server.apps.collect.drivers.opcua import driver as opcua_driver
from collector_server.apps.collect.drivers.opcua.driver import OpcuaDriver
from unit.opcua_driver_fakes import (
    MAX_NODES,
    NOW_MS,
    make_child,
    make_driver,
    make_readings,
    make_spec,
)


def test_unparsable_address_is_rejected_alone() -> None:
    resolved, rejected = opcua_driver.resolve_points(
        [
            make_spec("good"),
            PointSpec(
                point_code="broken", address="乱写", sampling_interval_ms=1000
            ),
        ]
    )
    assert [item.point.point_code for item in resolved] == ["good"]
    assert [item.point_code for item in rejected] == ["broken"]


def test_points_are_grouped_by_sampling_interval() -> None:
    resolved, _ = opcua_driver.resolve_points(
        [
            make_spec("fast", 200),
            make_spec("slow", 2000),
            make_spec("fast2", 200),
        ]
    )
    grouped = opcua_driver.group_by_interval(resolved)
    assert [(interval, len(batch)) for interval, batch in grouped] == [
        (200, 2),
        (2000, 1),
    ]


def test_publish_interval_never_goes_below_the_floor() -> None:
    resolved, _ = opcua_driver.resolve_points([make_spec("fast", 50)])
    assert (
        opcua_driver.publish_interval_ms(resolved)
        == opcua_driver.MIN_PUBLISH_INTERVAL_MS
    )


def test_status_code_in_the_handle_table_counts_as_rejected() -> None:
    resolved, _ = opcua_driver.resolve_points([make_spec("a"), make_spec("b")])
    accepted, rejected = opcua_driver.merge_handles(
        resolved, [7, ua.StatusCode(0x80340000)]
    )
    assert accepted == {"a": 7}
    assert [item.point_code for item in rejected] == ["b"]


def test_missing_handle_counts_as_rejected() -> None:
    resolved, _ = opcua_driver.resolve_points([make_spec("a"), make_spec("b")])
    accepted, rejected = opcua_driver.merge_handles(resolved, [7])
    assert accepted == {"a": 7}
    assert [item.detail for item in rejected] == ["no_handle"]


def test_samples_keep_the_requested_order() -> None:
    values = [
        ua.DataValue(Value=ua.Variant(1.5)),
        ua.DataValue(Value=ua.Variant(2.5)),
    ]
    aligned = opcua_driver.align_samples(
        ["a", "unknown", "b"], ["a", "b"], values, now_ms=NOW_MS
    )
    assert aligned == [
        (1.5, NOW_MS, "good"),
        (None, NOW_MS, "bad"),
        (2.5, NOW_MS, "good"),
    ]


def test_variable_nodes_are_leaves_in_the_browse_tree() -> None:
    variable = ua.ReferenceDescription(
        NodeId=ua.ExpandedNodeId(Identifier="Temp1", NamespaceIndex=2),
        BrowseName=ua.QualifiedName("Temp1", 2),
        NodeClass_=ua.NodeClass.Variable,
    )
    folder = ua.ReferenceDescription(
        NodeId=ua.ExpandedNodeId(Identifier="Dev", NamespaceIndex=2),
        BrowseName=ua.QualifiedName("Dev", 2),
        NodeClass_=ua.NodeClass.Object,
    )
    items = opcua_driver.browse_items([variable, folder])
    assert [
        (item.name, item.is_variable, item.has_children) for item in items
    ] == [
        ("Temp1", True, False),
        ("Dev", False, True),
    ]


def test_capabilities_declare_all_three_abilities() -> None:
    made, _ = make_driver()
    assert made.capabilities == opcua_driver.CAPABILITIES


def test_fingerprint_carries_a_digest_instead_of_the_password() -> None:
    made = OpcuaDriver(
        connection=DriverConnection(
            endpoint="opc.tcp://plc:4840",
            username="operator",
            password="s3cret-value",
            options={"policy": "None"},
        )
    )
    fingerprint = made.fingerprint()
    assert fingerprint[0] == "opc.tcp://plc:4840"
    assert "s3cret-value" not in fingerprint
    assert fingerprint[-1] == "policy=None"


def test_fingerprint_changes_when_the_endpoint_changes() -> None:
    one = OpcuaDriver(connection=DriverConnection(endpoint="opc.tcp://a:4840"))
    other = OpcuaDriver(
        connection=DriverConnection(endpoint="opc.tcp://b:4840")
    )
    assert one.fingerprint() != other.fingerprint()


async def test_reading_before_connecting_is_refused() -> None:
    made, _ = make_driver()
    with pytest.raises(DriverNotConnected):
        await made.read_many(["a"])


async def test_writing_an_unregistered_point_is_refused() -> None:
    made, _ = make_driver()
    await made.connect()
    with pytest.raises(PointNotLoaded):
        await made.write("nobody", 1)


async def test_write_reaches_the_node_of_the_registered_address() -> None:
    made, built = make_driver()
    await made.connect()
    made.load_points([make_spec("outlet_temp")])
    await made.write("outlet_temp", 21.5)
    node = built[0].built["ns=2;s=outlet_temp"]
    assert node.written == [21.5]


async def test_heartbeat_asks_the_connection() -> None:
    made, built = make_driver()
    await made.connect()
    await made.healthcheck()
    assert built[0].is_checked is True


async def test_a_connect_timeout_closes_the_half_open_socket() -> None:
    made, built = make_driver(connect_s=0.01, is_connect_hung=True)
    with pytest.raises(TimeoutError):
        await made.connect()
    assert built[0].is_socket_closed is True


async def test_a_cancelled_connect_closes_the_half_open_socket() -> None:
    made, built = make_driver(is_connect_hung=True)
    connecting = asyncio.create_task(made.connect())
    await asyncio.sleep(0)
    connecting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await connecting
    assert built[0].is_socket_closed is True


async def test_a_successful_connect_keeps_its_socket() -> None:
    made, built = make_driver()
    await made.connect()
    assert built[0].is_socket_closed is False


async def test_disconnect_clears_the_session() -> None:
    made, built = make_driver()
    await made.connect()
    await made.disconnect()
    assert built[0].is_connected is False
    with pytest.raises(DriverNotConnected):
        await made.browse(None)


async def test_subscribe_splits_batches_per_sampling_interval() -> None:
    made, built = make_driver()
    await made.connect()
    result = await made.subscribe(
        [make_spec("fast", 200), make_spec("slow", 2000)], lambda *_: None
    )
    assert set(result.accepted) == {"fast", "slow"}
    assert built[0].subscription.batches == [(1, 200.0), (1, 2000.0)]


async def test_subscribe_reads_a_stable_point_without_notifications() -> None:
    made, built = make_driver()
    await made.connect()
    built[0].values = {"ns=2;s=stable": ua.DataValue(Value=ua.Variant(21.5))}
    seen: list[tuple[str, object, int, str]] = []
    result = await made.subscribe(
        [make_spec("stable")], lambda *sample: seen.append(sample)
    )
    assert result.accepted == ("stable",)
    assert seen == [("stable", 21.5, NOW_MS, "good")]


async def test_subscribe_keeps_points_outside_this_batch_registered() -> None:
    made, built = make_driver()
    await made.connect()
    made.load_points([make_spec("kept"), make_spec("added")])
    await made.subscribe([make_spec("added")], lambda *_: None)
    await made.write("kept", 1)
    assert "ns=2;s=kept" in built[0].built


async def test_unsubscribe_returns_how_many_were_really_dropped() -> None:
    made, built = make_driver()
    await made.connect()
    await made.subscribe([make_spec("a"), make_spec("b")], lambda *_: None)
    dropped = await made.unsubscribe(["a", "never-subscribed"])
    assert dropped == 1
    assert built[0].subscription.dropped == [1]


async def test_read_many_returns_one_entry_per_requested_point() -> None:
    made, built = make_driver()
    await made.connect()
    made.load_points([make_spec("a")])
    built[0].values = {"ns=2;s=a": ua.DataValue(Value=ua.Variant(3.5))}
    samples = await made.read_many(["a", "unregistered"])
    assert samples == [(3.5, NOW_MS, "good"), (None, NOW_MS, "bad")]


async def test_read_many_without_any_known_point_asks_nobody() -> None:
    made, built = make_driver()
    await made.connect()
    samples = await made.read_many(["ghost"])
    assert samples == [(None, NOW_MS, "bad")]
    assert built[0].built == {}


async def test_read_many_splits_batches_at_max_nodes_per_read() -> None:
    """⚠ 超 MaxNodesPerRead 是整批被拒，现象是这一轮**一个值都没有**。"""
    made, built = make_driver()
    await made.connect()
    codes = [f"p{index}" for index in range(MAX_NODES + 1)]
    made.load_points([make_spec(code) for code in codes])
    built[0].values = make_readings(codes)
    built[0].max_nodes_per_read = MAX_NODES
    samples = await made.read_many(codes)
    assert samples == [
        (float(index), NOW_MS, "good") for index in range(len(codes))
    ]


async def test_read_many_keeps_the_order_across_the_batch_seam() -> None:
    """⚠ 各批的回包按位置拼回请求顺序：拼错是把值配到别的点位上，不报错。"""
    made, built = make_driver()
    await made.connect()
    codes = [f"p{index}" for index in range(MAX_NODES + 2)]
    made.load_points([make_spec(code) for code in codes])
    built[0].values = make_readings(codes)
    built[0].max_nodes_per_read = MAX_NODES
    await made.read_many(codes)
    assert [len(asked) for _, asked in built[0].asked] == [MAX_NODES, 2]


async def test_browse_from_the_root_uses_the_objects_folder() -> None:
    made, built = make_driver()
    await made.connect()
    built[0].nodes.objects.children = [
        ua.ReferenceDescription(
            NodeId=ua.ExpandedNodeId(Identifier="Dev", NamespaceIndex=2),
            BrowseName=ua.QualifiedName("Dev", 2),
            NodeClass_=ua.NodeClass.Object,
        )
    ]
    items = await made.browse(None)
    assert [item.address for item in items] == ["ns=2;s=Dev"]


async def test_browse_asks_the_field_what_type_each_variable_is() -> None:
    made, built = make_driver()
    await made.connect()
    built[0].nodes.objects.children = [
        make_child("Temp", is_variable=True),
        make_child("Name", is_variable=True),
        make_child("Dev", is_variable=False),
    ]
    built[0].types = {
        "ns=2;s=Temp": ua.ObjectIds.Double,
        "ns=2;s=Name": ua.ObjectIds.String,
    }
    items = await made.browse(None)
    assert [(item.address, item.data_type) for item in items] == [
        ("ns=2;s=Temp", "float"),
        ("ns=2;s=Name", "string"),
        ("ns=2;s=Dev", None),
    ]


async def test_browse_only_asks_about_the_variables() -> None:
    """⚠ 对象节点当不了点位，问它的类型是白花一次设备往返。"""
    made, built = make_driver()
    await made.connect()
    built[0].nodes.objects.children = [
        make_child("Temp", is_variable=True),
        make_child("Dev", is_variable=False),
    ]
    await made.browse(None)
    assert built[0].asked == [(int(ua.AttributeIds.DataType), ["ns=2;s=Temp"])]


async def test_a_layer_without_variables_costs_no_extra_round_trip() -> None:
    made, built = make_driver()
    await made.connect()
    built[0].nodes.objects.children = [make_child("Dev", is_variable=False)]
    await made.browse(None)
    assert built[0].asked == []


async def test_the_type_read_is_split_into_batches() -> None:
    """⚠ 服务端的 MaxNodesPerRead 一超就是整批被拒，不是截断。"""
    made, built = make_driver()
    await made.connect()
    count = MAX_NODES + 1
    built[0].nodes.objects.children = [
        make_child(f"T{index}", is_variable=True) for index in range(count)
    ]
    await made.browse(None)
    assert [len(addresses) for _, addresses in built[0].asked] == [
        MAX_NODES,
        1,
    ]


async def test_the_tree_still_comes_back_when_types_cannot_be_read() -> None:
    """⚠ 类型只是建点位时的预选值：为它让整棵地址空间浏览不出来是本末倒置。"""
    made, built = make_driver()
    await made.connect()
    built[0].nodes.objects.children = [make_child("Temp", is_variable=True)]
    built[0].type_error = TimeoutError()
    items = await made.browse(None)
    assert [(item.address, item.data_type) for item in items] == [
        ("ns=2;s=Temp", None)
    ]


async def test_browse_from_a_parent_addresses_that_node() -> None:
    made, built = make_driver()
    await made.connect()
    items = await made.browse("ns=2;s=Dev")
    assert items == []
    assert "ns=2;s=Dev" in built[0].built
