"""发布 / 取消发布 / 公开只读走完整条 HTTP 路径。

⚠ 这一层守的是「撤回是真的」：重复发布必须换新令牌、旧链接必须当场 404，
而这两件事在单测里看不出来——它们要的是同一张屏在库里被改过两次。
"""

from typing import Any

import httpx
import pytest
from conftest import SignHeaders

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    NODES_URL,
    data_of,
    make_dashboard,
    make_node,
    make_project,
    node_body,
)
from platform_server.apps.dashboard.catalog import (
    DASHBOARD_EDIT,
    DASHBOARD_VIEW,
)
from platform_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

PUBLIC_URL = f"{API_PREFIX}/public-dashboards"
HTTP_OK = 200
HTTP_CREATED = 201
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404
CODE_DASHBOARD_NOT_FOUND = 41002
CODE_NOT_PUBLISHED = 41016
MISSING_ID = "00000000-0000-7000-8000-000000000000"


def strip_identity(client: httpx.AsyncClient) -> None:
    """摘掉客户端上的签名身份头，之后的请求就是一个匿名访客。

    ⚠ 不能只置空某一个头：`get_caller` 只要认不出身份就 401，用例会因为
    「验签失败」而绿，而不是因为「这条路由本来就不要身份」。
    Args: client。
    """
    for name in list(client.headers):
        if name.lower().startswith("x-auth-"):
            del client.headers[name]


async def publish(
    client: httpx.AsyncClient,
    dashboard_id: str,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    """发布一张大屏。

    Args: client, dashboard_id, headers。
    """
    return await client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}:publish", headers=headers
    )


async def unpublish(
    client: httpx.AsyncClient,
    dashboard_id: str,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    """撤回公开。

    Args: client, dashboard_id, headers。
    """
    return await client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}:unpublish", headers=headers
    )


async def published_token(client: httpx.AsyncClient, dashboard_id: str) -> str:
    """发布一次并回它的公开令牌。

    Args: client, dashboard_id。
    """
    response = await publish(client, dashboard_id)
    assert response.status_code == HTTP_OK
    token = data_of(response)["public_token"]
    assert isinstance(token, str)
    return token


async def make_blank(client: httpx.AsyncClient) -> str:
    """建一张空白大屏并回它的 id。

    Args: client。
    """
    project_id = await make_project(client)
    dashboard = await make_dashboard(client, project_id=project_id)
    return str(dashboard["id"])


async def make_published(client: httpx.AsyncClient) -> tuple[str, str]:
    """建一张屏并发布，回 `(大屏 id, 公开令牌)`。

    Args: client。
    """
    dashboard_id = await make_blank(client)
    return dashboard_id, await published_token(client, dashboard_id)


async def make_withdrawn(client: httpx.AsyncClient) -> tuple[str, str]:
    """建一张屏、发布、再撤回，回 `(大屏 id, 已失效的令牌)`。

    Args: client。
    """
    dashboard_id, token = await make_published(client)
    assert (await unpublish(client, dashboard_id)).status_code == HTTP_OK
    return dashboard_id, token


async def make_twin_node(client: httpx.AsyncClient, dashboard_id: str) -> str:
    """建一个带绑定槽的节点并回它的 id。

    ⚠ 用 `twin-view` 而不是默认的 `header`：清单里只有它声明了绑定槽，
    往 `header` 上挂绑定会被「这个模块没有这个槽」挡在 400。
    Args: client, dashboard_id。
    """
    node = await make_node(
        client,
        dashboard_id=dashboard_id,
        body=node_body(module_type="twin-view"),
    )
    return str(node["id"])


async def bind_static(client: httpx.AsyncClient, node_id: str) -> None:
    """给一个节点挂一条常量绑定。

    Args: client, node_id。
    """
    response = await client.post(
        f"{NODES_URL}/{node_id}/bindings",
        json={
            "field_key": "anchorValues[0].value",
            "source_kind": "static",
            "static_value_json": "运行中",
        },
    )
    assert response.status_code in {HTTP_OK, HTTP_CREATED}


def field_keys_of(payload: dict[str, Any]) -> list[str]:
    """公开出参里全部节点的绑定槽名。

    Args: payload。
    """
    return [
        binding["field_key"]
        for node in payload["nodes"]
        for binding in node["bindings"]
    ]


async def test_publishing_turns_the_dashboard_public(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id, token = await make_published(app_client)
    detail = await app_client.get(f"{DASHBOARDS_URL}/{dashboard_id}")
    assert data_of(detail)["is_public"] is True
    assert len(token) > 0


async def test_the_public_link_needs_no_credentials_at_all(
    app_client: httpx.AsyncClient,
) -> None:
    _, token = await make_published(app_client)
    strip_identity(app_client)
    response = await app_client.get(f"{PUBLIC_URL}/{token}")
    assert response.status_code == HTTP_OK
    assert data_of(response)["name"] == "主屏"


async def test_republishing_mints_a_new_token_and_kills_the_old_link(
    app_client: httpx.AsyncClient,
) -> None:
    # 不换新的话「取消发布再发布」拿旧链接照样能看，撤回就是一句空话
    dashboard_id, first = await make_published(app_client)
    second = await published_token(app_client, dashboard_id)
    assert second != first
    stale = await app_client.get(f"{PUBLIC_URL}/{first}")
    assert stale.status_code == HTTP_NOT_FOUND
    assert stale.json()["code"] == CODE_NOT_PUBLISHED
    fresh = await app_client.get(f"{PUBLIC_URL}/{second}")
    assert fresh.status_code == HTTP_OK


async def test_unpublishing_closes_the_public_link(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id, token = await make_published(app_client)
    withdrawn = await unpublish(app_client, dashboard_id)
    assert withdrawn.status_code == HTTP_OK
    assert data_of(withdrawn)["is_public"] is False
    assert data_of(withdrawn)["public_token"] is None
    response = await app_client.get(f"{PUBLIC_URL}/{token}")
    assert response.status_code == HTTP_NOT_FOUND


async def test_a_withdrawn_link_is_indistinguishable_from_a_made_up_one(
    app_client: httpx.AsyncClient,
) -> None:
    # 分开回会让人拿旧链接试出「这张屏确实存在过」
    _, token = await make_withdrawn(app_client)
    withdrawn = await app_client.get(f"{PUBLIC_URL}/{token}")
    invented = await app_client.get(f"{PUBLIC_URL}/never-issued-token")
    assert withdrawn.status_code == invented.status_code == HTTP_NOT_FOUND
    assert withdrawn.json()["code"] == invented.json()["code"]
    assert withdrawn.json()["message"] == invented.json()["message"]


async def test_unpublishing_twice_is_not_an_error(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id, _ = await make_withdrawn(app_client)
    again = await unpublish(app_client, dashboard_id)
    assert again.status_code == HTTP_OK
    assert data_of(again)["public_token"] is None


async def test_the_same_idempotency_key_replays_the_first_token(
    app_client: httpx.AsyncClient,
) -> None:
    # 网络抖动导致的重试不该把上一秒刚发出去的链接换掉
    dashboard_id = await make_blank(app_client)
    key = {"Idempotency-Key": "publish-once"}
    first = await publish(app_client, dashboard_id, key)
    second = await publish(app_client, dashboard_id, key)
    assert first.status_code == second.status_code == HTTP_OK
    assert data_of(first)["public_token"] == data_of(second)["public_token"]


async def test_publishing_a_missing_dashboard_is_a_plain_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await publish(app_client, MISSING_ID)
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == CODE_DASHBOARD_NOT_FOUND


async def test_an_editor_cannot_publish_a_dashboard(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    # 公开一张屏是把它交给全互联网，编辑权限不够
    editor = sign([DASHBOARD_VIEW, DASHBOARD_EDIT])
    response = await publish(app_client, MISSING_ID, editor)
    assert response.status_code == HTTP_FORBIDDEN


async def test_an_editor_cannot_unpublish_a_dashboard(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    editor = sign([DASHBOARD_VIEW, DASHBOARD_EDIT])
    response = await unpublish(app_client, MISSING_ID, editor)
    assert response.status_code == HTTP_FORBIDDEN


async def test_the_public_payload_carries_no_internal_fields(
    app_client: httpx.AsyncClient,
) -> None:
    _, token = await make_published(app_client)
    strip_identity(app_client)
    payload = data_of(await app_client.get(f"{PUBLIC_URL}/{token}"))
    leaked = {"id", "project_id", "created_at", "is_public", "public_token"}
    assert leaked & set(payload) == set()


async def test_the_public_payload_carries_the_node_tree(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_blank(app_client)
    await bind_static(
        app_client, await make_twin_node(app_client, dashboard_id)
    )
    token = await published_token(app_client, dashboard_id)
    strip_identity(app_client)
    payload = data_of(await app_client.get(f"{PUBLIC_URL}/{token}"))
    assert [item["module_type"] for item in payload["nodes"]] == ["twin-view"]
    assert field_keys_of(payload) == ["anchorValues[0].value"]


async def test_the_public_node_hides_its_owning_dashboard(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_blank(app_client)
    await make_node(app_client, dashboard_id=dashboard_id)
    token = await published_token(app_client, dashboard_id)
    strip_identity(app_client)
    payload = data_of(await app_client.get(f"{PUBLIC_URL}/{token}"))
    node = payload["nodes"][0]
    assert "dashboard_id" not in node
    assert (node["x"], node["y"], node["w"], node["h"]) == (0, 0, 1920, 96)
