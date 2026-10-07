"""历史 numeric 配置可管理，别名冲突不能覆盖运行时节点。"""

from collections.abc import Callable
from math import isfinite
from typing import Any
from uuid import UUID

import httpx
import pytest
from asyncua import Client, ua

from lib.db import Database
from opcua_server.apps.instance.deps import PERM_MANAGE, PERM_OPERATE, PERM_VIEW
from opcua_server.apps.instance.models import Node
from opcua_server.settings import API_PREFIX

pytestmark = [
    pytest.mark.requires_postgres,
    pytest.mark.usefixtures("clean_tables"),
]
INSTANCES = f"{API_PREFIX}/instances"
Headers = Callable[..., dict[str, str]]


async def _instance(
    client: httpx.AsyncClient, headers: Headers
) -> dict[str, Any]:
    response = await client.post(
        INSTANCES,
        headers=headers(PERM_MANAGE),
        json={
            "name": "legacy-nodes",
            "namespace_uri": "urn:test:legacy",
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
    identifier: str,
) -> dict[str, Any]:
    response = await client.post(
        f"{INSTANCES}/{instance_id}/nodes",
        headers=headers(PERM_MANAGE),
        json={
            "identifier": identifier,
            "browse_name": "Value",
            "data_type": "double",
            "initial_value": 20.5,
            "access_level": 3,
        },
    )
    assert response.status_code == 201, response.text
    return dict(response.json()["data"]["node"])


async def _make_legacy(
    database: Database, node_id: str, identifier: str
) -> None:
    async with database.session() as session:
        row = await session.get(Node, UUID(node_id))
        assert row is not None
        row.identifier, row.identifier_kind = identifier, "numeric"


@pytest.mark.parametrize("identifier", ["001", "0001"])
async def test_legacy_numeric_alias_remains_visible_and_starts_as_numeric(
    client: httpx.AsyncClient,
    sign_headers: Headers,
    database: Database,
    identifier: str,
) -> None:
    instance = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance["id"], "legacy")
    await _make_legacy(database, node["id"], identifier)
    listed = await client.get(
        f"{INSTANCES}/{instance['id']}/nodes", headers=sign_headers(PERM_VIEW)
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["data"]["items"][0]["identifier"] == identifier
    assert listed.json()["data"]["items"][0]["node_id"] == "ns=2;i=1"
    started = await client.post(
        f"{INSTANCES}/{instance['id']}:start",
        headers=sign_headers(PERM_OPERATE),
    )
    assert started.status_code == 200, started.text
    async with Client(
        f"opc.tcp://127.0.0.1:{instance['port']}{instance['endpoint_path']}",
        timeout=5,
    ) as connected:
        assert await connected.get_node("ns=2;i=1").read_value() == 20.5
    duplicate = await client.post(
        f"{INSTANCES}/{instance['id']}/nodes",
        headers=sign_headers(PERM_MANAGE),
        json={
            "identifier": "1",
            "identifier_kind": "numeric",
            "browse_name": "Alias",
        },
    )
    assert duplicate.status_code == 409, duplicate.text


@pytest.mark.parametrize("identifier", ["4294967296", "18446744073709551616"])
async def test_invalid_legacy_numeric_node_can_be_listed_and_deleted(
    client: httpx.AsyncClient,
    sign_headers: Headers,
    database: Database,
    identifier: str,
) -> None:
    instance = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance["id"], "legacy")
    await _make_legacy(database, node["id"], identifier)
    listed = await client.get(
        f"{INSTANCES}/{instance['id']}/nodes", headers=sign_headers(PERM_VIEW)
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["data"]["items"][0]["identifier"] == identifier
    path = f"{INSTANCES}/{instance['id']}/nodes/{node['id']}"
    detail = await client.get(path, headers=sign_headers(PERM_VIEW))
    assert detail.status_code == 200, detail.text
    started = await client.post(
        f"{INSTANCES}/{instance['id']}:start",
        headers=sign_headers(PERM_OPERATE),
    )
    assert started.status_code == 400, started.text
    status = await client.get(
        f"{INSTANCES}/{instance['id']}", headers=sign_headers(PERM_VIEW)
    )
    assert status.json()["data"]["is_running"] is False
    deleted = await client.delete(path, headers=sign_headers(PERM_MANAGE))
    assert deleted.status_code == 204


async def test_existing_numeric_alias_collision_fails_before_listening(
    client: httpx.AsyncClient, sign_headers: Headers, database: Database
) -> None:
    instance = await _instance(client, sign_headers)
    first = await _node(client, sign_headers, instance["id"], "first")
    second = await _node(client, sign_headers, instance["id"], "second")
    await _make_legacy(database, first["id"], "001")
    await _make_legacy(database, second["id"], "1")
    started = await client.post(
        f"{INSTANCES}/{instance['id']}:start",
        headers=sign_headers(PERM_OPERATE),
    )
    assert started.status_code == 409, started.text
    assert started.json()["code"] == 42107
    listed = await client.get(
        f"{INSTANCES}/{instance['id']}/nodes", headers=sign_headers(PERM_VIEW)
    )
    assert listed.status_code == 200
    assert len(listed.json()["data"]["items"]) == 2


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
async def test_nonfinite_runtime_value_has_a_controlled_management_read_error(
    app: httpx.ASGITransport, sign_headers: Headers, value: float
) -> None:
    transport = httpx.ASGITransport(app=app.app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        instance = await _instance(client, sign_headers)
        node = await _node(client, sign_headers, instance["id"], "value")
        started = await client.post(
            f"{INSTANCES}/{instance['id']}:start",
            headers=sign_headers(PERM_OPERATE),
        )
        assert started.status_code == 200, started.text
        running = app.app.state.container.supervisor.find(UUID(instance["id"]))
        assert running is not None
        server = running._server
        assert server is not None
        await server.get_node(node["node_id"]).write_value(
            ua.Variant(value, ua.VariantType.Double)
        )
        async with Client(
            f"opc.tcp://127.0.0.1:{instance['port']}{instance['endpoint_path']}",
            timeout=5,
        ) as connected:
            assert not isfinite(
                await connected.get_node(node["node_id"]).read_value()
            )
            response = await client.get(
                f"{INSTANCES}/{instance['id']}/nodes/{node['id']}/value",
                headers=sign_headers(PERM_VIEW),
            )
            assert response.status_code == 400, response.text
            assert response.json()["code"] == 42108
            assert response.json()["trace_id"]
