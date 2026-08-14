"""节点面：id 稳定、撞键 409、父子与模块类型写错一律 400 且指到字段。

⚠ 参考实现在这些位置全是静默降级 + 200：父节点找不到就悄悄变顶层、
模块类型拼错照常入库。
"""

import uuid

import httpx
import pytest

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    HTTP_BAD_REQUEST,
    HTTP_CONFLICT,
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    NODES_URL,
    data_of,
    issue_fields,
    make_dashboard,
    make_node,
    make_project,
    node_body,
)

pytestmark = pytest.mark.requires_postgres


async def make_screen(client: httpx.AsyncClient) -> str:
    """建一个项目加一张大屏，回大屏 id。

    Args: client。
    """
    project_id = await make_project(client)
    dashboard = await make_dashboard(client, project_id=project_id)
    return str(dashboard["id"])


async def test_a_created_node_keeps_the_geometry_it_was_given(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    node = await make_node(app_client, dashboard_id=dashboard_id)
    assert (node["x"], node["y"], node["w"], node["h"]) == (0, 0, 1920, 96)


async def test_a_created_node_answers_with_a_location_header(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}/nodes", json=node_body()
    )
    node_id = data_of(response)["id"]
    assert response.headers["Location"] == f"{NODES_URL}/{node_id}"


async def test_an_unregistered_module_type_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}/nodes",
        json=node_body(module_type="gauge-chart"),
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert issue_fields(response) == [("module_type", "module_type_unknown")]


async def test_the_unknown_module_error_carries_the_domain_code(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}/nodes",
        json=node_body(module_type="gauge-chart"),
    )
    assert response.json()["code"] == 41010


async def test_a_parent_that_does_not_exist_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}/nodes",
        json=node_body(parent_id=str(uuid.uuid4())),
    )
    assert issue_fields(response) == [("parent_id", "parent_not_found")]


async def test_a_parent_on_another_dashboard_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    first = await make_screen(app_client)
    second = await make_screen(app_client)
    stranger = await make_node(app_client, dashboard_id=first)
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{second}/nodes",
        json=node_body(parent_id=stranger["id"]),
    )
    assert issue_fields(response) == [("parent_id", "parent_not_found")]


async def test_two_nodes_claiming_one_client_key_conflict(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    await make_node(
        app_client, dashboard_id=dashboard_id, body=node_body(client_key="a")
    )
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}/nodes",
        json=node_body(client_key="a"),
    )
    assert response.status_code == HTTP_CONFLICT
    assert response.json()["code"] == 41005
    assert issue_fields(response) == [("client_key", "client_key_taken")]


async def test_the_same_client_key_on_two_dashboards_is_fine(
    app_client: httpx.AsyncClient,
) -> None:
    first = await make_screen(app_client)
    second = await make_screen(app_client)
    await make_node(
        app_client, dashboard_id=first, body=node_body(client_key="a")
    )
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{second}/nodes", json=node_body(client_key="a")
    )
    assert response.status_code == HTTP_CREATED


async def test_an_update_keeps_the_node_id(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    node = await make_node(app_client, dashboard_id=dashboard_id)
    response = await app_client.patch(
        f"{NODES_URL}/{node['id']}", json={"x": 100, "z_index": 3}
    )
    assert data_of(response)["id"] == node["id"]
    assert (data_of(response)["x"], data_of(response)["z_index"]) == (100, 3)


async def test_reparenting_a_node_onto_itself_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    node = await make_node(app_client, dashboard_id=dashboard_id)
    response = await app_client.patch(
        f"{NODES_URL}/{node['id']}", json={"parent_id": node["id"]}
    )
    assert issue_fields(response) == [("parent_id", "parent_is_self")]


async def test_a_two_node_cycle_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    root = await make_node(
        app_client, dashboard_id=dashboard_id, body=node_body(client_key="r")
    )
    child = await make_node(
        app_client,
        dashboard_id=dashboard_id,
        body=node_body(client_key="c", parent_id=root["id"]),
    )
    response = await app_client.patch(
        f"{NODES_URL}/{root['id']}", json={"parent_id": child["id"]}
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert ("parent_id", "parent_cycle") in issue_fields(response)


async def test_clearing_the_parent_lifts_a_node_to_the_top(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    root = await make_node(
        app_client, dashboard_id=dashboard_id, body=node_body(client_key="r")
    )
    child = await make_node(
        app_client,
        dashboard_id=dashboard_id,
        body=node_body(client_key="c", parent_id=root["id"]),
    )
    response = await app_client.patch(
        f"{NODES_URL}/{child['id']}", json={"parent_id": None}
    )
    assert data_of(response)["parent_id"] is None


async def test_deleting_a_node_takes_its_subtree(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    root = await make_node(
        app_client, dashboard_id=dashboard_id, body=node_body(client_key="r")
    )
    child = await make_node(
        app_client,
        dashboard_id=dashboard_id,
        body=node_body(client_key="c", parent_id=root["id"]),
    )
    deleted = await app_client.delete(f"{NODES_URL}/{root['id']}")
    assert deleted.status_code == HTTP_NO_CONTENT
    response = await app_client.get(f"{NODES_URL}/{child['id']}")
    assert response.status_code == HTTP_NOT_FOUND


async def test_the_node_listing_is_ordered_by_parent_then_layer(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    top = await make_node(
        app_client, dashboard_id=dashboard_id, body=node_body(client_key="t")
    )
    for index, layer in enumerate([5, 1]):
        body = node_body(client_key=f"c{index}", parent_id=top["id"])
        body["z_index"] = layer
        await app_client.post(
            f"{DASHBOARDS_URL}/{dashboard_id}/nodes", json=body
        )
    response = await app_client.get(
        NODES_URL, params={"dashboard_id": dashboard_id}
    )
    items = response.json()["data"]
    assert [item["z_index"] for item in items] == [0, 1, 5]


async def test_a_missing_node_answers_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{NODES_URL}/{uuid.uuid4()}")
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == 41003


async def test_a_zero_width_node_is_refused_by_the_schema(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    body = node_body()
    body["w"] = 0
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}/nodes", json=body
    )
    assert response.status_code == HTTP_BAD_REQUEST


async def test_an_unknown_field_in_the_body_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    body = node_body()
    body["zIndex"] = 3
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}/nodes", json=body
    )
    assert response.status_code == HTTP_BAD_REQUEST
