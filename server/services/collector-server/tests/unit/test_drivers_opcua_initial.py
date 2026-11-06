"""守 OPC UA 初值补读、早到通知与重复地址的分发。"""

import asyncio
from datetime import UTC, datetime

import pytest
from asyncua import ua

from collector_server.apps.collect.drivers.base import PointSpec
from unit.opcua_driver_fakes import (
    MAX_NODES,
    NOW_MS,
    make_driver,
    make_readings,
    make_spec,
)


async def test_first_notification_before_subscribe_returns_is_kept() -> None:
    driver, clients = make_driver()
    await driver.connect()
    client = clients[0]
    client.subscription.notifications = {
        "ns=2;s=stable": ua.DataValue(Value=ua.Variant(21.5))
    }
    client.read_errors["ns=2;s=stable"] = TimeoutError()
    seen: list[tuple[str, object, int, str]] = []
    await driver.subscribe(
        [make_spec("stable")], lambda *item: seen.append(item)
    )
    assert seen == [("stable", 21.5, NOW_MS, "good")]
    assert client.asked == [(int(ua.AttributeIds.Value), ["ns=2;s=stable"])]


async def test_every_subscribed_point_is_actively_read_at_start() -> None:
    driver, clients = make_driver()
    await driver.connect()
    client = clients[0]
    reading = ua.DataValue(Value=ua.Variant(21.5))
    client.values = {"ns=2;s=stable": reading}
    client.subscription.notifications = {"ns=2;s=stable": reading}
    await driver.subscribe([make_spec("stable")], lambda *_: None)
    assert client.asked == [(int(ua.AttributeIds.Value), ["ns=2;s=stable"])]


async def test_one_address_notifies_every_point_bound_to_it() -> None:
    driver, clients = make_driver()
    await driver.connect()
    seen: list[tuple[str, object, int, str]] = []
    await driver.subscribe(
        [make_spec("stable"), PointSpec("alias", "ns=2;s=stable", 1000)],
        lambda *item: seen.append(item),
    )
    seen.clear()
    client = clients[0]
    client.subscription.notify(
        client.get_node(ua.NodeId.from_string("ns=2;s=stable")),
        ua.DataValue(Value=ua.Variant(21.5)),
    )
    assert sorted(seen) == [
        ("alias", 21.5, NOW_MS, "good"),
        ("stable", 21.5, NOW_MS, "good"),
    ]


@pytest.mark.parametrize("value", [0.0, False], ids=["zero", "false"])
async def test_initial_read_preserves_zero_and_false(value: object) -> None:
    driver, clients = make_driver()
    await driver.connect()
    clients[0].values = {"ns=2;s=stable": ua.DataValue(Value=ua.Variant(value))}
    seen: list[tuple[str, object, int, str]] = []
    await driver.subscribe(
        [make_spec("stable")], lambda *item: seen.append(item)
    )
    assert seen == [("stable", value, NOW_MS, "good")]


async def test_initial_read_preserves_device_timestamp_and_bad_quality() -> (
    None
):
    driver, clients = make_driver()
    await driver.connect()
    clients[0].values = {
        "ns=2;s=stable": ua.DataValue(
            Value=ua.Variant(0.0),
            SourceTimestamp=datetime(2026, 1, 1, tzinfo=UTC),
            StatusCode_=ua.StatusCode(ua.StatusCodes.BadNoCommunication),
        )
    }
    seen: list[tuple[str, object, int, str]] = []
    await driver.subscribe(
        [make_spec("stable")], lambda *item: seen.append(item)
    )
    assert seen == [("stable", 0.0, 1_767_225_600_000, "bad")]


async def test_initial_read_batches_keep_every_point_aligned() -> None:
    driver, clients = make_driver()
    await driver.connect()
    codes = [f"p{index}" for index in range(MAX_NODES + 1)]
    clients[0].max_nodes_per_read = MAX_NODES
    clients[0].values = make_readings(codes)
    seen: list[tuple[str, object, int, str]] = []
    await driver.subscribe(
        [make_spec(code) for code in codes], lambda *item: seen.append(item)
    )
    assert seen == [
        (code, float(index), NOW_MS, "good") for index, code in enumerate(codes)
    ]
    assert [len(addresses) for _, addresses in clients[0].asked] == [
        MAX_NODES,
        1,
    ]


async def test_initial_read_refreshes_early_notifications() -> None:
    driver, clients = make_driver()
    await driver.connect()
    client = clients[0]
    client.subscription.notifications = {
        "ns=2;s=notified": ua.DataValue(Value=ua.Variant(1.0))
    }
    client.values = {
        "ns=2;s=notified": ua.DataValue(Value=ua.Variant(1.5)),
        "ns=2;s=stable": ua.DataValue(Value=ua.Variant(2.0)),
    }
    seen: list[tuple[str, object, int, str]] = []
    await driver.subscribe(
        [make_spec("notified"), make_spec("stable")],
        lambda *item: seen.append(item),
    )
    assert seen == [
        ("notified", 1.0, NOW_MS, "good"),
        ("notified", 1.5, NOW_MS, "good"),
        ("stable", 2.0, NOW_MS, "good"),
    ]
    assert client.asked == [
        (int(ua.AttributeIds.Value), ["ns=2;s=notified", "ns=2;s=stable"])
    ]


async def test_a_notification_during_initial_read_wins_over_the_read() -> None:
    driver, clients = make_driver()
    await driver.connect()
    client = clients[0]
    client.values = {"ns=2;s=stable": ua.DataValue(Value=ua.Variant(1.0))}
    client.on_read = lambda: client.subscription.notify(
        client.get_node(ua.NodeId.from_string("ns=2;s=stable")),
        ua.DataValue(Value=ua.Variant(2.0)),
    )
    seen: list[tuple[str, object, int, str]] = []
    await driver.subscribe(
        [make_spec("stable")], lambda *item: seen.append(item)
    )
    assert seen == [("stable", 2.0, NOW_MS, "good")]


async def test_a_failed_initial_batch_does_not_block_later_batches() -> None:
    driver, clients = make_driver()
    await driver.connect()
    client = clients[0]
    codes = [f"p{index}" for index in range(MAX_NODES + 1)]
    client.values = make_readings(codes)
    client.read_errors["ns=2;s=p0"] = TimeoutError()
    seen: list[tuple[str, object, int, str]] = []
    result = await driver.subscribe(
        [make_spec(code) for code in codes], lambda *item: seen.append(item)
    )
    assert result.accepted == tuple(codes)
    assert seen == [("p100", 100.0, NOW_MS, "good")]
    client.subscription.notify(
        client.get_node(ua.NodeId.from_string("ns=2;s=p0")),
        ua.DataValue(Value=ua.Variant(1.0)),
    )
    assert seen[-1] == ("p0", 1.0, NOW_MS, "good")


async def test_cancelling_initial_read_propagates() -> None:
    driver, clients = make_driver()
    await driver.connect()
    clients[0].read_errors["ns=2;s=stable"] = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await driver.subscribe([make_spec("stable")], lambda *_: None)


async def test_initial_read_timeout_preserves_subscription(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver, clients = make_driver(request_s=0.01)
    await driver.connect()
    was_cancelled = asyncio.Event()

    async def hang(*_: object) -> list[ua.DataValue]:
        try:
            await asyncio.Event().wait()
        finally:
            was_cancelled.set()
        return []

    monkeypatch.setattr(clients[0], "read_attributes", hang)
    result = await driver.subscribe([make_spec("stable")], lambda *_: None)
    assert result.accepted == ("stable",)
    assert was_cancelled.is_set()


async def test_rejected_points_are_not_read_or_kept_in_the_notifier() -> None:
    driver, clients = make_driver()
    await driver.connect()
    client = clients[0]
    client.subscription.rejected["ns=2;s=rejected"] = ua.StatusCode(
        ua.StatusCodes.BadNodeIdUnknown
    )
    client.values = {"ns=2;s=stable": ua.DataValue(Value=ua.Variant(1.0))}
    seen: list[tuple[str, object, int, str]] = []
    result = await driver.subscribe(
        [make_spec("rejected"), make_spec("stable")],
        lambda *item: seen.append(item),
    )
    client.subscription.notify(
        client.get_node(ua.NodeId.from_string("ns=2;s=rejected")),
        ua.DataValue(Value=ua.Variant(2.0)),
    )
    assert result.accepted == ("stable",)
    assert [item.point_code for item in result.rejected] == ["rejected"]
    assert client.asked == [(int(ua.AttributeIds.Value), ["ns=2;s=stable"])]
    assert seen == [("stable", 1.0, NOW_MS, "good")]


async def test_failed_subscription_drops_provisional_mappings() -> None:
    driver, clients = make_driver()
    await driver.connect()
    client = clients[0]
    client.subscription.error = TimeoutError()
    seen: list[tuple[str, object, int, str]] = []
    with pytest.raises(TimeoutError):
        await driver.subscribe(
            [make_spec("stable")], lambda *item: seen.append(item)
        )
    client.subscription.notify(
        client.get_node(ua.NodeId.from_string("ns=2;s=stable")),
        ua.DataValue(Value=ua.Variant(2.0)),
    )
    assert seen == []
    assert client.asked == []


async def test_unsubscribing_one_alias_keeps_the_other_active() -> None:
    driver, clients = make_driver()
    await driver.connect()
    seen: list[tuple[str, object, int, str]] = []
    await driver.subscribe(
        [make_spec("stable"), PointSpec("alias", "ns=2;s=stable", 1000)],
        lambda *item: seen.append(item),
    )
    assert await driver.unsubscribe(["stable"]) == 1
    seen.clear()
    client = clients[0]
    client.subscription.notify(
        client.get_node(ua.NodeId.from_string("ns=2;s=stable")),
        ua.DataValue(Value=ua.Variant(2.0)),
    )
    assert seen == [("alias", 2.0, NOW_MS, "good")]


async def test_rejected_alias_never_receives_an_early_notification() -> None:
    driver, clients = make_driver()
    await driver.connect()
    client = clients[0]
    client.values = {"ns=2;s=stable": ua.DataValue(Value=ua.Variant(1.0))}
    seen: list[tuple[str, object, int, str]] = []
    await driver.subscribe(
        [make_spec("stable")], lambda *item: seen.append(item)
    )
    seen.clear()
    client.subscription.notifications = {
        "ns=2;s=stable": ua.DataValue(Value=ua.Variant(2.0))
    }
    client.subscription.rejected["ns=2;s=stable"] = ua.StatusCode(
        ua.StatusCodes.BadTooManyMonitoredItems
    )
    result = await driver.subscribe(
        [PointSpec("alias", "ns=2;s=stable", 1000)],
        lambda *item: seen.append(item),
    )
    assert result.accepted == ()
    assert seen == [("stable", 2.0, NOW_MS, "good")]


async def test_adding_points_only_seeds_the_new_points() -> None:
    driver, clients = make_driver()
    await driver.connect()
    client = clients[0]
    client.values = make_readings(["stable", "added"])
    seen: list[tuple[str, object, int, str]] = []
    await driver.subscribe(
        [make_spec("stable")], lambda *item: seen.append(item)
    )
    client.asked.clear()
    seen.clear()
    await driver.subscribe(
        [make_spec("added")], lambda *item: seen.append(item)
    )
    assert client.asked == [(int(ua.AttributeIds.Value), ["ns=2;s=added"])]
    assert seen == [("added", 1.0, NOW_MS, "good")]


async def test_reconnecting_reads_fresh_initial_values() -> None:
    driver, clients = make_driver()
    await driver.connect()
    clients[0].values = {"ns=2;s=stable": ua.DataValue(Value=ua.Variant(1.0))}
    seen: list[tuple[str, object, int, str]] = []
    await driver.subscribe(
        [make_spec("stable")], lambda *item: seen.append(item)
    )
    await driver.disconnect()
    await driver.connect()
    clients[1].values = {"ns=2;s=stable": ua.DataValue(Value=ua.Variant(2.0))}
    await driver.subscribe(
        [make_spec("stable")], lambda *item: seen.append(item)
    )
    assert seen == [
        ("stable", 1.0, NOW_MS, "good"),
        ("stable", 2.0, NOW_MS, "good"),
    ]
