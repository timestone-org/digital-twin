"""管理面加/删节点是**热生效**的：实例在跑就当场改地址空间。

⚠ 这一组必须用真实 `asyncua.Client` 收口。管理面自己 `GET .../value` 读到新值
证明不了热生效——它读的是同一份进程内存。只有另一头的上位机当场读到，
才算「不重启也生效」。

⚠ 另一半是**不留半成品**：热加失败时那一行不能留在库里，否则管理面列得出
一个上位机读不到的节点，而且要等下次重启才自愈。
"""

from collections.abc import Callable
from typing import Any

import httpx
import pytest
from asyncua import Client, ua

from opcua_server.apps.instance.deps import PERM_MANAGE, PERM_OPERATE, PERM_VIEW
from opcua_server.apps.instance.errors import NodeIdentifierTaken
from opcua_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

INSTANCES = f"{API_PREFIX}/instances"
LOOPBACK = "127.0.0.1"
OK = 200
CREATED = 201
NO_CONTENT = 204
BAD_REQUEST = 400
NOT_FOUND = 404

Headers = Callable[..., dict[str, str]]


async def _running(
    client: httpx.AsyncClient, headers: Headers
) -> tuple[str, str]:
    """建一台实例并起起来，返回实例 id 与回环上的 endpoint。

    ⚠ 实例绑的是 `0.0.0.0`，展示用的 endpoint 未必可从测试进程连上；
    所以按 port 自己拼一个回环地址。

    Args: client, headers。
    """
    created = await client.post(
        INSTANCES,
        json={
            "name": "hot-host",
            "namespace_uri": "urn:test:hot",
            "security_policies": ["NoSecurity"],
            "is_anonymous_allowed": True,
        },
        headers=headers(PERM_MANAGE),
    )
    assert created.status_code == CREATED, created.text
    data = created.json()["data"]
    started = await client.post(
        f"{INSTANCES}/{data['id']}:start", headers=headers(PERM_OPERATE)
    )
    assert started.status_code == OK, started.text
    path = str(data["endpoint_path"]).lstrip("/")
    return str(data["id"]), f"opc.tcp://{LOOPBACK}:{data['port']}/{path}"


async def _create(
    client: httpx.AsyncClient,
    headers: Headers,
    instance_id: str,
    **overrides: Any,
) -> httpx.Response:
    body: dict[str, Any] = {
        "identifier": "Hot01",
        "browse_name": "HotPoint",
        "data_type": "int32",
        "initial_value": 7,
        "access_level": 3,
    }
    body.update(overrides)
    return await client.post(
        f"{INSTANCES}/{instance_id}/nodes",
        json=body,
        headers=headers(PERM_MANAGE),
    )


@pytest.mark.usefixtures("clean_tables")
async def test_node_added_through_the_api_is_visible_to_a_real_client(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """⚠ 只有另一头的上位机读到，才算证明了热生效。"""
    instance_id, endpoint = await _running(client, sign_headers)
    async with Client(url=endpoint) as upstream:
        response = await _create(client, sign_headers, instance_id)
        assert response.status_code == CREATED, response.text
        node_id = str(response.json()["data"]["node"]["node_id"])
        assert await upstream.get_node(node_id).read_value() == 7


@pytest.mark.usefixtures("clean_tables")
async def test_a_hot_added_node_reports_nothing_pending(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """加节点不再是「待重启生效」——CONTEXT.md §6 的承诺要真的成立。"""
    instance_id, _ = await _running(client, sign_headers)
    response = await _create(client, sign_headers, instance_id)
    assert response.json()["data"]["pending_fields"] == []


@pytest.mark.usefixtures("clean_tables")
async def test_deleting_a_node_removes_it_for_a_real_client_at_once(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    instance_id, endpoint = await _running(client, sign_headers)
    created = await _create(client, sign_headers, instance_id)
    node = created.json()["data"]["node"]
    async with Client(url=endpoint) as upstream:
        assert await upstream.get_node(str(node["node_id"])).read_value() == 7
        removed = await client.delete(
            f"{INSTANCES}/{instance_id}/nodes/{node['id']}",
            headers=sign_headers(PERM_MANAGE),
        )
        assert removed.status_code == NO_CONTENT
        with pytest.raises(ua.UaStatusCodeError):
            await upstream.get_node(str(node["node_id"])).read_value()


@pytest.mark.usefixtures("clean_tables")
async def test_a_failed_hot_add_leaves_no_row_behind(
    client: httpx.AsyncClient,
    sign_headers: Headers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 补偿失效就会留下「库里有、上位机读不到」的半成品。"""
    instance_id, _ = await _running(client, sign_headers)

    async def _refuse(*_args: object, **_kwargs: object) -> None:
        raise NodeIdentifierTaken("模拟地址空间拒绝加入")

    monkeypatch.setattr(
        "opcua_server.apps.instance.runtime.instance.RunningInstance.add_node",
        _refuse,
    )
    failed = await _create(client, sign_headers, instance_id)
    assert failed.status_code >= BAD_REQUEST
    listed = await client.get(
        f"{INSTANCES}/{instance_id}/nodes", headers=sign_headers(PERM_VIEW)
    )
    assert listed.json()["data"]["items"] == []


@pytest.mark.usefixtures("clean_tables")
async def test_method_node_class_is_refused_with_a_reason(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """方法节点要绑服务端回调，本服务没有可绑的用户代码（CONTEXT.md §3）。"""
    instance_id, _ = await _running(client, sign_headers)
    response = await _create(
        client, sign_headers, instance_id, node_class="method"
    )
    assert response.status_code == BAD_REQUEST
    assert "method" in response.json()["message"]


@pytest.mark.usefixtures("clean_tables")
async def test_a_refused_method_node_is_not_stored(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    instance_id, _ = await _running(client, sign_headers)
    await _create(client, sign_headers, instance_id, node_class="method")
    listed = await client.get(
        f"{INSTANCES}/{instance_id}/nodes", headers=sign_headers(PERM_VIEW)
    )
    assert listed.json()["data"]["items"] == []


@pytest.mark.usefixtures("clean_tables")
async def test_an_unknown_parent_is_rejected(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """⚠ 不许静默挂到根下：上位机的 BrowsePath 会整片失效。"""
    instance_id, _ = await _running(client, sign_headers)
    response = await _create(
        client,
        sign_headers,
        instance_id,
        parent_id="00000000-0000-0000-0000-0000000000ff",
    )
    assert response.status_code == NOT_FOUND


@pytest.mark.usefixtures("clean_tables")
async def test_a_child_is_reachable_by_browse_path_from_the_client(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """父子关系挂错时，BrowsePath 会落空——这是唯一能验出来的地方。"""
    instance_id, endpoint = await _running(client, sign_headers)
    parent = await _create(
        client,
        sign_headers,
        instance_id,
        identifier="Plant",
        browse_name="Plant",
        node_class="object",
        data_type=None,
        initial_value=None,
    )
    assert parent.status_code == CREATED, parent.text
    child = await _create(
        client,
        sign_headers,
        instance_id,
        identifier="Plant.Temp",
        browse_name="Temperature",
        parent_id=parent.json()["data"]["node"]["id"],
    )
    assert child.status_code == CREATED, child.text
    async with Client(url=endpoint) as upstream:
        found = await upstream.get_objects_node().get_child(
            ["2:Plant", "2:Temperature"]
        )
        assert found.nodeid.to_string() == str(
            child.json()["data"]["node"]["node_id"]
        )
