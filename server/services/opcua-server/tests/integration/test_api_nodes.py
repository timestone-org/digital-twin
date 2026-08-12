"""节点面的语义：值不落库、标识不可改、写值的幂等与权限。"""

from collections.abc import Callable
from typing import Any

import httpx
import pytest

from opcua_server.apps.instance.deps import (
    PERM_MANAGE,
    PERM_OPERATE,
    PERM_VIEW,
)
from opcua_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

INSTANCES = f"{API_PREFIX}/instances"
OK = 200
CREATED = 201
BAD_REQUEST = 400
FORBIDDEN = 403
NOT_FOUND = 404
CONFLICT = 409

Headers = Callable[..., dict[str, str]]


async def _instance(client: httpx.AsyncClient, headers: Headers) -> str:
    response = await client.post(
        INSTANCES,
        json={
            "name": "nodes-host",
            "namespace_uri": "urn:test:nodes",
            "security_policies": ["NoSecurity"],
        },
        headers=headers(PERM_MANAGE),
    )
    assert response.status_code == CREATED
    return str(response.json()["data"]["id"])


async def _node(
    client: httpx.AsyncClient,
    headers: Headers,
    instance_id: str,
    **overrides: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "identifier": "Temp01",
        "browse_name": "Temperature",
        "data_type": "double",
        "initial_value": 20.5,
        "access_level": 3,
    }
    body.update(overrides)
    response = await client.post(
        f"{INSTANCES}/{instance_id}/nodes",
        json=body,
        headers=headers(PERM_MANAGE),
    )
    assert response.status_code == CREATED, response.text
    return dict(response.json()["data"]["node"])


@pytest.mark.usefixtures("clean_tables")
async def test_node_id_uses_the_pinned_namespace_index(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """完整 NodeId 的命名空间索引恒为 2（不变式 4）。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance_id)
    assert node["node_id"] == "ns=2;s=Temp01"


@pytest.mark.usefixtures("clean_tables")
async def test_numeric_identifier_uses_the_i_form(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """数字标识拼成 `i=`，字符串标识拼成 `s=`。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    node = await _node(
        client,
        sign_headers,
        instance_id,
        identifier="1001",
        identifier_kind="numeric",
    )
    assert node["node_id"] == "ns=2;i=1001"


@pytest.mark.usefixtures("clean_tables")
async def test_duplicate_identifier_is_rejected_not_renamed(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """标识冲突只报错，绝不自动改名（不变式 3）。

    ⚠ 自动改名会让现场那些硬编码了 NodeId 的组态在下次重启后集体失灵。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    await _node(client, sign_headers, instance_id)
    response = await client.post(
        f"{INSTANCES}/{instance_id}/nodes",
        json={
            "identifier": "Temp01",
            "browse_name": "Another",
            "data_type": "double",
        },
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == CONFLICT
    assert response.json()["code"] == 42107


@pytest.mark.usefixtures("clean_tables")
async def test_identifier_cannot_be_changed(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """改节点的入参里根本没有 `identifier`，多传就拒。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance_id)
    response = await client.put(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}",
        json={"identifier": "Renamed"},
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == BAD_REQUEST


@pytest.mark.usefixtures("clean_tables")
async def test_value_read_is_not_live_when_stopped(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """实例没在跑时读到的是初值，且 `is_live` 标注了这一点。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance_id)
    response = await client.get(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}/value",
        headers=sign_headers(PERM_VIEW),
    )
    body = response.json()["data"]
    assert body["is_live"] is False
    assert body["value"] == 20.5


@pytest.mark.usefixtures("clean_tables")
async def test_write_requires_operate_not_view(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """写值要 `opcua:operate`——它在物理上等价于对现场下指令。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance_id)
    response = await client.post(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}:write",
        json={"value": 30.0},
        headers=sign_headers(PERM_VIEW),
    )
    assert response.status_code == FORBIDDEN


@pytest.mark.usefixtures("clean_tables")
async def test_write_to_stopped_instance_is_rejected(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """实例没跑就写不了值，返回 409 而不是假装写成功。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance_id)
    response = await client.post(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}:write",
        json={"value": 30.0},
        headers=sign_headers(PERM_OPERATE),
    )
    assert response.status_code == CONFLICT
    assert response.json()["code"] == 42105


@pytest.mark.usefixtures("clean_tables")
async def test_written_value_does_not_reach_the_database(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """写值只改运行时内存，初值列纹丝不动（不变式 1、2）。

    ⚠ 这条是「重启回初值」这个语义的直接证据：写完再停，读回来还是初值。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance_id)
    await client.post(
        f"{INSTANCES}/{instance_id}:start", headers=sign_headers(PERM_OPERATE)
    )
    written = await client.post(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}:write",
        json={"value": 42.0},
        headers=sign_headers(PERM_OPERATE),
    )
    assert written.status_code == OK
    assert written.json()["data"]["value"] == 42.0

    definition = await client.get(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}",
        headers=sign_headers(PERM_VIEW),
    )
    assert definition.json()["data"]["initial_value"] == 20.5

    await client.post(
        f"{INSTANCES}/{instance_id}:stop", headers=sign_headers(PERM_OPERATE)
    )
    after_stop = await client.get(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}/value",
        headers=sign_headers(PERM_VIEW),
    )
    assert after_stop.json()["data"]["value"] == 20.5


@pytest.mark.usefixtures("clean_tables")
async def test_write_is_idempotent_with_a_key(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """带幂等键重放写值，返回首次结果而不是再写一次。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance_id)
    await client.post(
        f"{INSTANCES}/{instance_id}:start", headers=sign_headers(PERM_OPERATE)
    )
    headers = sign_headers(PERM_OPERATE)
    headers["Idempotency-Key"] = "write-once"
    first = await client.post(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}:write",
        json={"value": 11.0},
        headers=headers,
    )
    second = await client.post(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}:write",
        json={"value": 99.0},
        headers=headers,
    )
    assert first.json()["data"]["value"] == 11.0
    # ⚠ 第二次带的是 99，但幂等键让它拿回首次结果——这正是防重复下发的点
    assert second.json()["data"]["value"] == 11.0


@pytest.mark.usefixtures("clean_tables")
async def test_node_of_another_instance_is_not_found(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """跨实例取节点按不存在处理，不泄漏「这个 id 是存在的」。

    Args: client, sign_headers。
    """
    first = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, first)
    other = await client.post(
        INSTANCES,
        json={
            "name": "other-host",
            "namespace_uri": "urn:test:other",
            "security_policies": ["NoSecurity"],
        },
        headers=sign_headers(PERM_MANAGE),
    )
    other_id = other.json()["data"]["id"]
    response = await client.get(
        f"{INSTANCES}/{other_id}/nodes/{node['id']}",
        headers=sign_headers(PERM_VIEW),
    )
    assert response.status_code == NOT_FOUND
