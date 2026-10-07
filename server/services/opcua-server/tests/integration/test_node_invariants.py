"""节点配置、在线写值与真实 OPC UA NodeId 的一致性。"""

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from asyncua import Client, ua

from opcua_server.apps.instance.deps import PERM_MANAGE, PERM_OPERATE, PERM_VIEW
from opcua_server.settings import API_PREFIX, INTERNAL_PREFIX, Settings

pytestmark = [
    pytest.mark.requires_postgres,
    pytest.mark.usefixtures("clean_tables"),
]
INSTANCES = f"{API_PREFIX}/instances"
Headers = Callable[..., dict[str, str]]
INVALID_INITIALS = [
    ("int32", 2**31),
    ("int32", 1.5),
    ("int32", "wrong"),
    ("int64", 2**63),
    ("boolean", "false"),
    ("float", 1e40),
    ("double", "not-numeric"),
    ("string", 1),
    ("byte_string", 1),
]
VALID_INITIALS = [
    ("boolean", True, ua.VariantType.Boolean),
    ("int32", -(2**31), ua.VariantType.Int32),
    ("int64", 2**63 - 1, ua.VariantType.Int64),
    ("float", 3.25, ua.VariantType.Float),
    ("double", -6.5, ua.VariantType.Double),
    ("string", "温度 / literal <script>", ua.VariantType.String),
    ("byte_string", "温度", ua.VariantType.ByteString),
]


async def _instance(
    client: httpx.AsyncClient, headers: Headers
) -> dict[str, Any]:
    response = await client.post(
        INSTANCES,
        headers=headers(PERM_MANAGE),
        json={
            "name": "node-invariants",
            "namespace_uri": "urn:test:invariants",
            "security_policies": ["NoSecurity"],
            "is_anonymous_allowed": True,
        },
    )
    assert response.status_code == 201, response.text
    return dict(response.json()["data"])


async def _node(
    client: httpx.AsyncClient,
    headers: Headers,
    instance_id: str,
    *,
    should_omit_initial: bool = False,
    **overrides: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "identifier": "value",
        "browse_name": "Value",
        "data_type": "double",
        "initial_value": 20.5,
        "access_level": 3,
    }
    body.update(overrides)
    if should_omit_initial:
        del body["initial_value"]
    response = await client.post(
        f"{INSTANCES}/{instance_id}/nodes",
        headers=headers(PERM_MANAGE),
        json=body,
    )
    assert response.status_code == 201, response.text
    return dict(response.json()["data"]["node"])


async def _start(
    client: httpx.AsyncClient, headers: Headers, instance_id: str
) -> None:
    response = await client.post(
        f"{INSTANCES}/{instance_id}:start", headers=headers(PERM_OPERATE)
    )
    assert response.status_code == 200, response.text


def _url(instance: dict[str, Any]) -> str:
    return f"opc.tcp://127.0.0.1:{instance['port']}{instance['endpoint_path']}"


@pytest.mark.parametrize(("kind", "value"), INVALID_INITIALS)
async def test_invalid_initial_value_never_reaches_storage(
    client: httpx.AsyncClient, sign_headers: Headers, kind: str, value: object
) -> None:
    instance = await _instance(client, sign_headers)
    response = await client.post(
        f"{INSTANCES}/{instance['id']}/nodes",
        headers=sign_headers(PERM_MANAGE),
        json={
            "identifier": "bad",
            "browse_name": "Bad",
            "data_type": kind,
            "initial_value": value,
        },
    )
    assert response.status_code == 400, response.text
    listed = await client.get(
        f"{INSTANCES}/{instance['id']}/nodes", headers=sign_headers(PERM_VIEW)
    )
    assert listed.json()["data"]["items"] == []


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
async def test_nonfinite_raw_json_is_rejected_before_storage(
    app: httpx.ASGITransport, sign_headers: Headers, literal: str
) -> None:
    transport = httpx.ASGITransport(app=app.app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        instance = await _instance(client, sign_headers)
        response = await client.post(
            f"{INSTANCES}/{instance['id']}/nodes",
            headers={
                **sign_headers(PERM_MANAGE),
                "Content-Type": "application/json",
            },
            content='{"identifier":"bad","browse_name":"Bad","data_type":"double","initial_value":'
            + literal
            + "}",
        )
        assert response.status_code == 400, response.text
        assert response.json()["data"] is None
        assert response.json()["trace_id"]
        assert "asyncpg" not in response.text
        assert "INSERT" not in response.text


@pytest.mark.parametrize(("kind", "value"), INVALID_INITIALS)
async def test_invalid_update_preserves_the_previous_definition(
    client: httpx.AsyncClient, sign_headers: Headers, kind: str, value: object
) -> None:
    instance = await _instance(client, sign_headers)
    initial = (
        False
        if kind == "boolean"
        else "" if kind in {"string", "byte_string"} else 0
    )
    node = await _node(
        client,
        sign_headers,
        instance["id"],
        data_type=kind,
        initial_value=initial,
    )
    response = await client.put(
        f"{INSTANCES}/{instance['id']}/nodes/{node['id']}",
        headers=sign_headers(PERM_MANAGE),
        json={"initial_value": value},
    )
    assert response.status_code == 400, response.text
    saved = await client.get(
        f"{INSTANCES}/{instance['id']}/nodes/{node['id']}",
        headers=sign_headers(PERM_VIEW),
    )
    assert saved.json()["data"]["initial_value"] == initial


async def test_data_type_update_checks_the_retained_initial_value(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    instance = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance["id"])
    path = f"{INSTANCES}/{instance['id']}/nodes/{node['id']}"
    rejected = await client.put(
        path, headers=sign_headers(PERM_MANAGE), json={"data_type": "int32"}
    )
    assert rejected.status_code == 400, rejected.text
    saved = await client.get(path, headers=sign_headers(PERM_VIEW))
    assert saved.json()["data"]["data_type"] == "double"
    accepted = await client.put(
        path,
        headers=sign_headers(PERM_MANAGE),
        json={"data_type": "int32", "initial_value": 7},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["data"]["node"]["initial_value"] == 7


async def test_numeric_node_id_is_readable_at_startup_and_after_hot_addition(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    instance = await _instance(client, sign_headers)
    first = await _node(
        client,
        sign_headers,
        instance["id"],
        identifier="1001",
        identifier_kind="numeric",
    )
    await _start(client, sign_headers, instance["id"])
    async with Client(_url(instance), timeout=5) as connected:
        assert first["node_id"] == "ns=2;i=1001"
        assert await connected.get_node(first["node_id"]).read_value() == 20.5
        second = await _node(
            client,
            sign_headers,
            instance["id"],
            identifier="4294967295",
            identifier_kind="numeric",
        )
        assert await connected.get_node(second["node_id"]).read_value() == 20.5
        with pytest.raises(ua.UaStatusCodeError):
            await connected.get_node("ns=2;s=1001").read_value()


@pytest.mark.parametrize(
    "identifier", ["abc", "-1", "1.5", "4294967296", "01001", "١"]
)
async def test_numeric_identifier_requires_a_unique_uint32_decimal_form(
    client: httpx.AsyncClient, sign_headers: Headers, identifier: str
) -> None:
    instance = await _instance(client, sign_headers)
    response = await client.post(
        f"{INSTANCES}/{instance['id']}/nodes",
        headers=sign_headers(PERM_MANAGE),
        json={
            "identifier": identifier,
            "identifier_kind": "numeric",
            "browse_name": "Bad",
        },
    )
    assert response.status_code == 400, response.text


async def test_all_seven_types_and_omitted_defaults_reach_a_real_client(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    instance = await _instance(client, sign_headers)
    saved = []
    for index, (kind, value, variant) in enumerate(VALID_INITIALS):
        node = await _node(
            client,
            sign_headers,
            instance["id"],
            identifier=f"v{index}",
            data_type=kind,
            initial_value=value,
        )
        assert node["initial_value"] == value
        default = await _node(
            client,
            sign_headers,
            instance["id"],
            identifier=f"d{index}",
            data_type=kind,
            should_omit_initial=True,
        )
        assert default["initial_value"] is None
        saved.append((node, default, kind, value, variant))
    await _start(client, sign_headers, instance["id"])
    async with Client(_url(instance), timeout=5) as connected:
        for node, default, kind, value, variant in saved:
            current = await connected.get_node(
                node["node_id"]
            ).read_data_value()
            expected = value.encode("utf-8") if kind == "byte_string" else value
            assert current.Value.VariantType == variant
            assert current.Value.Value == expected
            expected_default = (
                False
                if kind == "boolean"
                else (
                    ""
                    if kind == "string"
                    else b"" if kind == "byte_string" else 0
                )
            )
            assert (
                await connected.get_node(default["node_id"]).read_value()
                == expected_default
            )


@pytest.mark.parametrize(
    "literal", ["1e40", "NaN", "Infinity", "-Infinity", str(10**400)]
)
async def test_live_float_write_is_rejected_and_keeps_the_previous_value(
    client: httpx.AsyncClient, sign_headers: Headers, literal: str
) -> None:
    instance = await _instance(client, sign_headers)
    node = await _node(
        client,
        sign_headers,
        instance["id"],
        data_type="float",
        initial_value=3.25,
    )
    await _start(client, sign_headers, instance["id"])
    response = await client.post(
        f"{INSTANCES}/{instance['id']}/nodes/{node['id']}:write",
        headers={
            **sign_headers(PERM_OPERATE),
            "Content-Type": "application/json",
        },
        content='{"value":' + literal + "}",
    )
    assert response.status_code == 400, response.text
    async with Client(_url(instance), timeout=5) as connected:
        assert await connected.get_node(node["node_id"]).read_value() == 3.25


@pytest.mark.parametrize("literal", ["1e40", "NaN", "Infinity"])
async def test_internal_write_rejects_only_the_invalid_item(
    client: httpx.AsyncClient,
    sign_headers: Headers,
    settings: Settings,
    literal: str,
) -> None:
    instance = await _instance(client, sign_headers)
    node = await _node(
        client,
        sign_headers,
        instance["id"],
        data_type="float",
        initial_value=3.25,
    )
    await _start(client, sign_headers, instance["id"])
    body = json.dumps(
        {
            "instance_id": instance["id"],
            "items": [
                {"id": node["id"], "value": "INVALID"},
                {"id": node["id"], "value": 7.5},
            ],
        }
    )
    response = await client.post(
        f"{INTERNAL_PREFIX}/opcua/nodes:write",
        headers={
            "X-Service-Key": settings.edge_service_key.get_secret_value(),
            "Content-Type": "application/json",
        },
        content=body.replace('"INVALID"', literal),
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["written_count"] == 1
    assert [
        item["is_written"] for item in response.json()["data"]["items"]
    ] == [False, True]


@pytest.mark.parametrize("node_class", ["variable", "property", "object"])
async def test_nested_nonfinite_initial_values_cannot_bypass_validation(
    client: httpx.AsyncClient, sign_headers: Headers, node_class: str
) -> None:
    instance = await _instance(client, sign_headers)
    body = json.dumps(
        {
            "identifier": "bad",
            "browse_name": "Bad",
            "node_class": node_class,
            "initial_value": {"nested": ["INVALID"]},
        }
    )
    response = await client.post(
        f"{INSTANCES}/{instance['id']}/nodes",
        headers={
            **sign_headers(PERM_MANAGE),
            "Content-Type": "application/json",
        },
        content=body.replace('"INVALID"', "NaN"),
    )
    assert response.status_code == 400, response.text


@pytest.mark.parametrize(
    "kind",
    [
        "sbyte",
        "byte",
        "int16",
        "uint16",
        "uint32",
        "uint64",
        "datetime",
        "guid",
    ],
)
async def test_unsupported_runtime_types_are_rejected_before_storage(
    client: httpx.AsyncClient, sign_headers: Headers, kind: str
) -> None:
    instance = await _instance(client, sign_headers)
    response = await client.post(
        f"{INSTANCES}/{instance['id']}/nodes",
        headers=sign_headers(PERM_MANAGE),
        json={"identifier": "bad", "browse_name": "Bad", "data_type": kind},
    )
    assert response.status_code == 400, response.text


async def test_null_update_retains_the_current_initial_configuration(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    instance = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance["id"])
    response = await client.put(
        f"{INSTANCES}/{instance['id']}/nodes/{node['id']}",
        headers=sign_headers(PERM_MANAGE),
        json={"initial_value": None, "data_type": None},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["node"]["initial_value"] == 20.5
    assert response.json()["data"]["node"]["data_type"] == "double"
