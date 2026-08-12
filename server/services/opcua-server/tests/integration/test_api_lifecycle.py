"""补齐节点的增删改查与身份头的边界情形。"""

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
NO_CONTENT = 204
UNAUTHORIZED = 401

Headers = Callable[..., dict[str, str]]


async def _instance(client: httpx.AsyncClient, headers: Headers) -> str:
    response = await client.post(
        INSTANCES,
        json={
            "name": "life-host",
            "namespace_uri": "urn:test:life",
            "security_policies": ["NoSecurity"],
        },
        headers=headers(PERM_MANAGE),
    )
    return str(response.json()["data"]["id"])


async def _node(
    client: httpx.AsyncClient, headers: Headers, instance_id: str, ident: str
) -> dict[str, Any]:
    response = await client.post(
        f"{INSTANCES}/{instance_id}/nodes",
        json={
            "identifier": ident,
            "browse_name": ident,
            "data_type": "double",
            "initial_value": 1.0,
            "access_level": 3,
        },
        headers=headers(PERM_MANAGE),
    )
    assert response.status_code == CREATED, response.text
    return dict(response.json()["data"]["node"])


@pytest.mark.usefixtures("clean_tables")
async def test_nodes_are_listed_with_paging_and_search(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """节点列表支持分页与关键字。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    await _node(client, sign_headers, instance_id, "Alpha")
    await _node(client, sign_headers, instance_id, "Beta")

    listed = await client.get(
        f"{INSTANCES}/{instance_id}/nodes", headers=sign_headers(PERM_VIEW)
    )
    assert listed.json()["data"]["total"] == 2

    filtered = await client.get(
        f"{INSTANCES}/{instance_id}/nodes",
        params={"q": "alph"},
        headers=sign_headers(PERM_VIEW),
    )
    assert filtered.json()["data"]["total"] == 1


@pytest.mark.usefixtures("clean_tables")
async def test_updating_browse_name_reports_pending_when_running(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """实例在跑时改 BrowseName 要重启才生效，接口逐项说出来。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance_id, "Renameable")
    await client.post(
        f"{INSTANCES}/{instance_id}:start", headers=sign_headers(PERM_OPERATE)
    )
    response = await client.put(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}",
        json={"browse_name": "NewName"},
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == OK
    assert response.json()["data"]["pending_fields"] == ["browse_name"]


@pytest.mark.usefixtures("clean_tables")
async def test_updating_a_stopped_instance_reports_no_pending(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """没在跑的实例改什么都不算「未生效」——下次起来读的就是新值。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance_id, "Quiet")
    response = await client.put(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}",
        json={"browse_name": "AlsoQuiet"},
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.json()["data"]["pending_fields"] == []


@pytest.mark.usefixtures("clean_tables")
async def test_updating_only_the_description_changes_nothing_pending(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """描述不参与地址空间构建，改它不该触发待重启。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance_id, "Described")
    await client.post(
        f"{INSTANCES}/{instance_id}:start", headers=sign_headers(PERM_OPERATE)
    )
    response = await client.put(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}",
        json={"description": "说明"},
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.json()["data"]["pending_fields"] == []


@pytest.mark.usefixtures("clean_tables")
async def test_node_can_be_deleted(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """删节点返回 204，列表随之减少。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    node = await _node(client, sign_headers, instance_id, "Doomed")
    response = await client.delete(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}",
        headers=sign_headers(PERM_MANAGE),
    )
    assert response.status_code == NO_CONTENT
    listed = await client.get(
        f"{INSTANCES}/{instance_id}/nodes", headers=sign_headers(PERM_VIEW)
    )
    assert listed.json()["data"]["total"] == 0


@pytest.mark.usefixtures("clean_tables")
async def test_restart_clears_pending_restart(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """重启之后待重启标记清掉——配置已经生效了。

    Args: client, sign_headers。
    """
    instance_id = await _instance(client, sign_headers)
    await _node(client, sign_headers, instance_id, "Restarted")
    await client.post(
        f"{INSTANCES}/{instance_id}:start", headers=sign_headers(PERM_OPERATE)
    )
    await client.put(
        f"{INSTANCES}/{instance_id}",
        json={"namespace_uri": "urn:test:life2"},
        headers=sign_headers(PERM_MANAGE),
    )
    restarted = await client.post(
        f"{INSTANCES}/{instance_id}:restart",
        headers=sign_headers(PERM_OPERATE),
    )
    assert restarted.status_code == OK
    detail = await client.get(
        f"{INSTANCES}/{instance_id}", headers=sign_headers(PERM_VIEW)
    )
    assert detail.json()["data"]["has_pending_restart"] is False


@pytest.mark.usefixtures("clean_tables")
async def test_instances_can_be_searched(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """实例列表支持关键字过滤。

    Args: client, sign_headers。
    """
    await _instance(client, sign_headers)
    filtered = await client.get(
        INSTANCES, params={"q": "life"}, headers=sign_headers(PERM_VIEW)
    )
    assert filtered.json()["data"]["total"] == 1


@pytest.mark.usefixtures("clean_tables")
async def test_expired_identity_header_is_rejected(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """过期的身份头拒绝——边缘签的东西也有寿命。

    Args: client, sign_headers。
    """
    headers = sign_headers(PERM_VIEW)
    headers["X-Auth-Exp"] = "1"
    response = await client.get(INSTANCES, headers=headers)
    assert response.status_code == UNAUTHORIZED


@pytest.mark.usefixtures("clean_tables")
async def test_non_integer_expiry_is_rejected(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """过期时刻不是整数时拒绝，而不是抛 500。

    Args: client, sign_headers。
    """
    headers = sign_headers(PERM_VIEW)
    headers["X-Auth-Exp"] = "not-a-number"
    response = await client.get(INSTANCES, headers=headers)
    assert response.status_code == UNAUTHORIZED


@pytest.mark.usefixtures("clean_tables")
async def test_non_uuid_subject_is_rejected(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """主体不是合法 UUID 时拒绝。

    ⚠ 这条走的是签名之后的路径：签名对得上但内容不合法，同样不能放行。

    Args: client, sign_headers。
    """
    headers = sign_headers(PERM_VIEW, user_id=None)
    headers["X-Auth-User-Id"] = "not-a-uuid"
    response = await client.get(INSTANCES, headers=headers)
    assert response.status_code == UNAUTHORIZED
