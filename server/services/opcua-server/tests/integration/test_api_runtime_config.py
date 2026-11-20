"""运行实例的端点、地址空间与保存配置的一致性。"""

import asyncio
from collections.abc import Callable
from urllib.parse import urlsplit

import httpx
import pytest
from asyncua import Client

from opcua_server.apps.instance.deps import PERM_MANAGE, PERM_OPERATE, PERM_VIEW
from opcua_server.apps.instance.runtime.instance import RunningInstance
from opcua_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

INSTANCES = f"{API_PREFIX}/instances"
OK = 200
CREATED = 201
Headers = Callable[..., dict[str, str]]


def _payload(name: str, **overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "name": name,
        "namespace_uri": f"urn:test:{name}",
        "security_policies": ["NoSecurity"],
    }
    body.update(overrides)
    return body


async def _create(
    client: httpx.AsyncClient, headers: Headers, name: str, **overrides: object
) -> dict[str, object]:
    response = await client.post(
        INSTANCES,
        json=_payload(name, **overrides),
        headers=headers(PERM_MANAGE),
    )
    assert response.status_code == CREATED
    return response.json()["data"]


@pytest.mark.usefixtures("clean_tables")
async def test_a_running_instance_advertises_its_new_name_after_restart(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    data = await _create(client, sign_headers, "station")
    path = f"{INSTANCES}/{data['id']}"
    endpoint = f"opc.tcp://127.0.0.1:{data['port']}{data['endpoint_path']}"
    started = await client.post(
        f"{path}:start", headers=sign_headers(PERM_OPERATE)
    )
    assert started.status_code == OK, started.text

    response = await client.put(
        path, json={"name": "new-station"}, headers=sign_headers(PERM_MANAGE)
    )
    assert response.status_code == OK, response.text
    assert response.json()["data"]["has_pending_restart"] is True
    assert response.json()["data"]["pending_fields"] == ["name"]
    before = await Client(url=endpoint).connect_and_get_server_endpoints()
    assert {entry.Server.ApplicationName.Text for entry in before} == {
        "station"
    }

    restarted = await client.post(
        f"{path}:restart", headers=sign_headers(PERM_OPERATE)
    )
    assert restarted.status_code == OK, restarted.text
    after = await Client(url=endpoint).connect_and_get_server_endpoints()
    assert {entry.Server.ApplicationName.Text for entry in after} == {
        "new-station"
    }
    detail = await client.get(path, headers=sign_headers(PERM_VIEW))
    assert detail.json()["data"]["has_pending_restart"] is False
    assert detail.json()["data"]["pending_fields"] == []


@pytest.mark.usefixtures("clean_tables")
async def test_endpoint_discovery_matches_the_configured_policies(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    response = await client.post(
        INSTANCES,
        json=_payload(
            "policy", security_policies=["Basic256Sha256_SignAndEncrypt"]
        ),
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == CREATED
    saved = response.json()["data"]
    root = f"{INSTANCES}/{saved['id']}"
    started = await client.post(
        f"{root}:start", headers=sign_headers(PERM_OPERATE)
    )
    assert started.status_code == OK
    endpoint = f"opc.tcp://127.0.0.1:{saved['port']}{saved['endpoint_path']}"
    descriptions = await Client(endpoint).connect_and_get_server_endpoints()
    assert [
        (item.SecurityPolicyUri.rsplit("#", 1)[-1], item.SecurityMode.name)
        for item in descriptions
    ] == [
        ("Basic256Sha256", "SignAndEncrypt"),
    ]
    for choices in (["Aes256Sha256RsaPss_Sign"], saved["security_policies"]):
        update = await client.put(
            root,
            json={"security_policies": choices},
            headers=sign_headers(PERM_MANAGE),
        )
        assert update.status_code == OK
        pending = update.json()["data"]
        assert pending["has_pending_restart"] == (
            choices != saved["security_policies"]
        )
        assert pending["pending_fields"] == (
            ["security_policies"]
            if choices != saved["security_policies"]
            else []
        )


@pytest.mark.usefixtures("clean_tables")
async def test_reported_endpoint_changes_when_the_listener_restarts(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    data = await _create(client, sign_headers, "endpoint-path")
    path = f"{INSTANCES}/{data['id']}"
    operate, manage = sign_headers(PERM_OPERATE), sign_headers(PERM_MANAGE)
    await client.post(path + ":start", headers=operate)
    saved = await client.put(
        path, json={"endpoint_path": "/next"}, headers=manage
    )
    assert saved.json()["data"]["endpoint_path"] == "/next"
    idle_start = await client.post(path + ":start", headers=operate)
    for response in (saved, idle_start):
        assert (
            urlsplit(response.json()["data"]["endpoint_url"]).path
            == data["endpoint_path"]
        )
    moved = await client.post(path + ":restart", headers=operate)
    endpoint = "opc.tcp://127.0.0.1:" + str(data["port"]) + "/next"
    native = await Client(endpoint).connect_and_get_server_endpoints()
    assert {urlsplit(item.EndpointUrl).path for item in native} == {"/next"}
    assert urlsplit(moved.json()["data"]["endpoint_url"]).path == "/next"


@pytest.mark.usefixtures("clean_tables")
async def test_config_saved_while_rebuilding_remains_pending(
    client: httpx.AsyncClient,
    sign_headers: Headers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = await _create(client, sign_headers, "rebuilding")
    path = f"{INSTANCES}/{data['id']}"
    manage, operate = sign_headers(PERM_MANAGE), sign_headers(PERM_OPERATE)
    added = await client.post(
        path + "/nodes",
        json={"browse_name": "first", "identifier": "stable"},
        headers=manage,
    )
    node = added.json()["data"]["node"]
    await client.post(path + ":start", headers=operate)
    captured, resume = asyncio.Event(), asyncio.Event()
    start = RunningInstance.start

    async def delayed(instance: RunningInstance) -> None:
        captured.set()
        await asyncio.wait_for(resume.wait(), timeout=10)
        await start(instance)

    monkeypatch.setattr(RunningInstance, "start", delayed)
    async with asyncio.TaskGroup() as group:
        restart = group.create_task(
            client.post(path + ":restart", headers=operate)
        )
        await asyncio.wait_for(captured.wait(), timeout=10)
        try:
            saved = await client.put(
                f"{path}/nodes/{node['id']}",
                json={"browse_name": "second"},
                headers=manage,
            )
            assert saved.status_code == OK
        finally:
            resume.set()
    assert restart.result().status_code == OK
    actual = await client.get(path, headers=sign_headers(PERM_VIEW))
    assert actual.json()["data"]["has_pending_restart"]
    await client.post(path + ":restart", headers=operate)
    settled = await client.get(path, headers=sign_headers(PERM_VIEW))
    assert not settled.json()["data"]["has_pending_restart"]


@pytest.mark.usefixtures("clean_tables")
async def test_restoring_nodes_clears_only_their_own_pending_changes(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    data = await _create(client, sign_headers, "revert-nodes")
    path = f"{INSTANCES}/{data['id']}"
    manage = sign_headers(PERM_MANAGE)
    await client.post(path + ":start", headers=sign_headers(PERM_OPERATE))
    nodes: list[str] = []
    for name in ("first", "second"):
        created = await client.post(
            path + "/nodes",
            json={"browse_name": name, "identifier": name},
            headers=manage,
        )
        node_id = created.json()["data"]["node"]["id"]
        node_url = f"{path}/nodes/{node_id}"
        nodes.append(node_url)
        changed = await client.put(
            node_url, json={"browse_name": name + "-new"}, headers=manage
        )
        assert changed.json()["data"]["pending_fields"] == ["browse_name"]
    restored = await client.put(
        nodes[0], json={"browse_name": "first"}, headers=manage
    )
    assert restored.json()["data"]["pending_fields"] == []
    before = await client.get(path, headers=sign_headers(PERM_VIEW))
    assert before.json()["data"]["has_pending_restart"]
    await client.delete(nodes[1], headers=manage)
    after = await client.get(path, headers=sign_headers(PERM_VIEW))
    assert not after.json()["data"]["has_pending_restart"]
