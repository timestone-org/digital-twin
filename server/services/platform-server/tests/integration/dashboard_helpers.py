"""大屏用例的共用造件：建项目、建大屏、建节点、读响应体。"""

from typing import Any

import httpx

from platform_server.settings import API_PREFIX

PROJECTS_URL = f"{API_PREFIX}/dashboard-projects"
DASHBOARDS_URL = f"{API_PREFIX}/dashboards"
NODES_URL = f"{API_PREFIX}/dashboard-nodes"
BINDINGS_URL = f"{API_PREFIX}/dashboard-bindings"
MODULE_TYPES_URL = f"{API_PREFIX}/module-types"
HTTP_CREATED = 201
HTTP_NO_CONTENT = 204
HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409


def data_of(response: httpx.Response) -> dict[str, Any]:
    """取信封里的 `data`。

    Args: response。
    """
    body: dict[str, Any] = response.json()
    payload = body["data"]
    assert isinstance(payload, dict)
    return payload


def details_of(response: httpx.Response) -> list[dict[str, Any]]:
    """取信封里的 `details`。

    Args: response。
    """
    body: dict[str, Any] = response.json()
    return list(body["details"] or [])


def issue_fields(response: httpx.Response) -> list[tuple[str, str]]:
    """把 `details` 压成（字段, 错误码）对，断言只看这两列。

    Args: response。
    """
    return [(item["field"], item["code"]) for item in details_of(response)]


async def make_project(client: httpx.AsyncClient, name: str = "光伏") -> str:
    """建一个项目并回它的 id。

    Args: client, name。
    """
    response = await client.post(PROJECTS_URL, json={"name": name})
    assert response.status_code == HTTP_CREATED
    return str(data_of(response)["id"])


async def make_dashboard(
    client: httpx.AsyncClient, *, project_id: str, name: str = "主屏"
) -> dict[str, Any]:
    """建一张大屏并回它的完整形态。

    Args: client, project_id, name。
    """
    response = await client.post(
        DASHBOARDS_URL, json={"project_id": project_id, "name": name}
    )
    assert response.status_code == HTTP_CREATED
    return data_of(response)


def node_body(
    *,
    module_type: str = "header",
    parent_id: str | None = None,
    client_key: str | None = None,
) -> dict[str, Any]:
    """一个最小的建节点请求体。

    Args: module_type, parent_id, client_key。
    """
    body: dict[str, Any] = {
        "module_type": module_type,
        "x": 0,
        "y": 0,
        "w": 1920,
        "h": 96,
    }
    if parent_id is not None:
        body["parent_id"] = parent_id
    if client_key is not None:
        body["client_key"] = client_key
    return body


async def make_node(
    client: httpx.AsyncClient,
    *,
    dashboard_id: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """建一个节点并回它的形态。

    Args: client, dashboard_id, body。
    """
    response = await client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}/nodes", json=body or node_body()
    )
    assert response.status_code == HTTP_CREATED
    return data_of(response)
