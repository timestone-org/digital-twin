"""原生浮点写值、权限与真实值订阅推送的契约。"""

import asyncio
import json
import math
import socket
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from asyncua import Client, ua

from opcua_server.apps.instance.runtime.addressspace import NodeDefinition
from opcua_server.apps.instance.runtime.instance import (
    InstanceSpec,
    RunningInstance,
    SecurityProfile,
)
from opcua_server.apps.instance.runtime.pki import PkiStore
from opcua_server.apps.instance.runtime.valuewatch import OnValueChange
from opcua_server.apps.instance.services.realtime import RealtimeClient
from opcua_server.apps.instance.services.value_publisher import ValuePublisher


def _instance(
    tmp_path: Path,
    nodes: tuple[NodeDefinition, ...],
    on_change: OnValueChange | None = None,
) -> RunningInstance:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = int(probe.getsockname()[1])
    spec = InstanceSpec(
        instance_id=uuid4(),
        name="native-write",
        port=port,
        host="127.0.0.1",
        namespace_uri="urn:test:native",
        nodes=nodes,
        security=SecurityProfile(
            allow_anonymous=True, allow_insecure_transport=True
        ),
    )
    return RunningInstance(
        spec, pki=PkiStore(tmp_path, valid_days=30), on_value_change=on_change
    )


@pytest.fixture
async def running(tmp_path: Path) -> AsyncIterator[RunningInstance]:
    instance = _instance(
        tmp_path,
        (
            NodeDefinition("double", "Double", "double", 20.5),
            NodeDefinition("float", "Float", "float", 20.5),
            NodeDefinition("readonly", "ReadOnly", "double", 20.5, False),
        ),
    )
    await instance.start()
    try:
        yield instance
    finally:
        await instance.stop()


def _publisher() -> tuple[ValuePublisher, RealtimeClient, list[dict[str, Any]]]:
    requests: list[dict[str, Any]] = []
    realtime = RealtimeClient(
        base_url="http://qa-realtime.invalid",
        service_key="qa-fixture-only",
        timeout_s=1,
    )
    realtime._transport = httpx.MockTransport(
        lambda request: (
            requests.append(json.loads(request.content))
            or httpx.Response(200, json={"data": {}})
        )
    )
    return (
        ValuePublisher(realtime=realtime, window_ms=1000, max_items=10),
        realtime,
        requests,
    )


@pytest.mark.parametrize("kind", ["double", "float"])
@pytest.mark.parametrize(
    "value",
    [float("nan"), float("inf"), -float("inf")],
    ids=["NaN", "+Inf", "-Inf"],
)
async def test_custom_native_write_rejects_nonfinite_without_mutating(
    running: RunningInstance, kind: str, value: float
) -> None:
    async with Client(running.spec.endpoint_url()) as client:
        node = client.get_node(f"ns=2;s={kind}")
        before = await node.read_value()
        variant_type = (
            ua.VariantType.Double if kind == "double" else ua.VariantType.Float
        )
        with pytest.raises(ua.UaStatusCodeError) as rejection:
            await node.write_value(ua.Variant(value, variant_type))
        assert rejection.value.code == ua.StatusCodes.BadOutOfRange
        assert await node.read_value() == before


async def test_readonly_nonfinite_preserves_permission_error(
    running: RunningInstance,
) -> None:
    async with Client(running.spec.endpoint_url()) as client:
        node = client.get_node("ns=2;s=readonly")
        with pytest.raises(ua.UaStatusCodeError) as rejection:
            await node.write_value(
                ua.Variant(float("nan"), ua.VariantType.Double)
            )
        assert rejection.value.code == ua.StatusCodes.BadUserAccessDenied
        assert await node.read_value() == 20.5


async def test_unknown_node_preserves_upstream_error(
    running: RunningInstance,
) -> None:
    async with Client(running.spec.endpoint_url()) as client:
        with pytest.raises(ua.UaStatusCodeError) as rejection:
            await client.get_node("ns=2;s=missing").write_value(
                ua.Variant(float("nan"), ua.VariantType.Double)
            )
        assert rejection.value.code == ua.StatusCodes.BadUserAccessDenied


async def test_mixed_native_write_preserves_results_and_valid_siblings(
    running: RunningInstance,
) -> None:
    async with Client(running.spec.endpoint_url()) as client:
        params = ua.WriteParameters()
        for node_id, value, variant in (
            ("ns=2;s=double", float("nan"), ua.VariantType.Double),
            ("ns=2;s=float", 37.25, ua.VariantType.Float),
            ("ns=2;s=double", float("inf"), ua.VariantType.Double),
        ):
            item = ua.WriteValue()
            item.NodeId = ua.NodeId.from_string(node_id)
            item.AttributeId = ua.AttributeIds.Value
            item.Value = ua.DataValue(ua.Variant(value, variant))
            params.NodesToWrite.append(item)
        statuses = await client.uaclient.write(params)
        assert [status.value for status in statuses] == [
            ua.StatusCodes.BadOutOfRange,
            0,
            ua.StatusCodes.BadOutOfRange,
        ]
        assert await client.get_node("ns=2;s=double").read_value() == 20.5
        assert await client.get_node("ns=2;s=float").read_value() == 37.25


async def test_standard_and_nonvalue_writes_preserve_upstream_errors(
    running: RunningInstance,
) -> None:
    async with Client(running.spec.endpoint_url()) as client:
        for node_id, attribute in (
            ("ns=0;i=2258", ua.AttributeIds.Value),
            ("ns=2;s=double", ua.AttributeIds.DisplayName),
        ):
            params = ua.WriteParameters()
            item = ua.WriteValue()
            item.NodeId = ua.NodeId.from_string(node_id)
            item.AttributeId = attribute
            item.Value = ua.DataValue(
                ua.Variant(float("nan"), ua.VariantType.Double)
            )
            params.NodesToWrite = [item]
            statuses = await client.uaclient.write(params)
            assert statuses[0].value == ua.StatusCodes.BadUserAccessDenied


@pytest.mark.parametrize("kind", ["double", "float"])
async def test_finite_native_write_reads_and_publishes(
    tmp_path: Path, kind: str
) -> None:
    publisher, realtime, requests = _publisher()
    changed = asyncio.Event()

    async def on_change(
        instance_id: UUID, identifier: str, value: object
    ) -> None:
        await publisher.record(instance_id, identifier, value)
        if value == 37.25:
            changed.set()

    instance = _instance(
        tmp_path, (NodeDefinition(kind, kind, kind, 20.5),), on_change
    )
    await instance.start()
    try:
        async with Client(instance.spec.endpoint_url()) as client:
            node = client.get_node(f"ns=2;s={kind}")
            variant_type = (
                ua.VariantType.Double
                if kind == "double"
                else ua.VariantType.Float
            )
            await node.write_value(ua.Variant(37.25, variant_type))
            assert await node.read_value() == 37.25
            await asyncio.wait_for(changed.wait(), timeout=5)
        await publisher.flush()
        assert any(
            item == {"identifier": kind, "value": 37.25}
            for request in requests
            for item in request["items"]
        )
        assert all(
            math.isfinite(item["value"])
            for request in requests
            for item in request["items"]
        )
    finally:
        await instance.stop()
        await realtime.close()
