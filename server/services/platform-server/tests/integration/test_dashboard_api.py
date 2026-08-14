"""大屏面：加载、元数据更新、行版本推进与自检。

⚠ `row_version`（乐观锁）与 `schema_version`（文档格式版本）是两列，
任何一次结构变更只推前者。
"""

import uuid

import httpx
import pytest

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    data_of,
    make_dashboard,
    make_node,
    make_project,
    node_body,
)

pytestmark = pytest.mark.requires_postgres


async def test_a_new_dashboard_starts_at_version_one_with_no_nodes(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    assert (dashboard["row_version"], dashboard["schema_version"]) == (1, 1)
    assert dashboard["nodes"] == []


async def test_a_new_dashboard_takes_the_default_design_size(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    assert (dashboard["design_width"], dashboard["design_height"]) == (
        1920,
        1080,
    )


async def test_creating_under_a_missing_project_answers_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        DASHBOARDS_URL, json={"project_id": str(uuid.uuid4()), "name": "主屏"}
    )
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == 41001


async def test_loading_a_dashboard_returns_its_nodes_flat(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    root = await make_node(app_client, dashboard_id=dashboard["id"])
    await make_node(
        app_client,
        dashboard_id=dashboard["id"],
        body=node_body(module_type="twin-view", parent_id=root["id"]),
    )
    response = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    parents = [item["parent_id"] for item in data_of(response)["nodes"]]
    assert parents == [None, root["id"]]


async def test_two_loads_of_an_untouched_dashboard_are_identical(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    for index in range(3):
        await make_node(
            app_client,
            dashboard_id=dashboard["id"],
            body=node_body(client_key=f"n{index}"),
        )
    first = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    second = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    assert data_of(first)["nodes"] == data_of(second)["nodes"]


async def test_updating_metadata_advances_the_row_version(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    response = await app_client.patch(
        f"{DASHBOARDS_URL}/{dashboard['id']}", json={"name": "改名"}
    )
    assert data_of(response)["row_version"] == 2


async def test_the_document_format_version_moves_on_its_own(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    response = await app_client.patch(
        f"{DASHBOARDS_URL}/{dashboard['id']}", json={"schema_version": 2}
    )
    assert (
        data_of(response)["schema_version"],
        data_of(response)["row_version"],
    ) == (2, 2)


async def test_a_null_on_a_non_nullable_field_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    response = await app_client.patch(
        f"{DASHBOARDS_URL}/{dashboard['id']}", json={"name": None}
    )
    assert response.status_code == 400


async def test_adding_a_node_advances_the_dashboard_version(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    await make_node(app_client, dashboard_id=dashboard["id"])
    response = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    assert data_of(response)["row_version"] == 2


async def test_deleting_a_dashboard_takes_its_nodes_with_it(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    node = await make_node(app_client, dashboard_id=dashboard["id"])
    deleted = await app_client.delete(f"{DASHBOARDS_URL}/{dashboard['id']}")
    assert deleted.status_code == HTTP_NO_CONTENT
    response = await app_client.get(
        f"/api/v1/platform/dashboard-nodes/{node['id']}"
    )
    assert response.status_code == HTTP_NOT_FOUND


async def test_a_dashboard_listing_filters_by_project(
    app_client: httpx.AsyncClient,
) -> None:
    kept = await make_project(app_client, "留下")
    other = await make_project(app_client, "别的")
    await make_dashboard(app_client, project_id=kept, name="甲")
    await make_dashboard(app_client, project_id=other, name="乙")
    response = await app_client.get(DASHBOARDS_URL, params={"project_id": kept})
    assert [item["name"] for item in response.json()["data"]["items"]] == ["甲"]


async def test_a_clean_dashboard_validates_without_issues(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    await make_node(app_client, dashboard_id=dashboard["id"])
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:validate"
    )
    assert data_of(response)["is_valid"] is True
    assert data_of(response)["issues"] == []


async def test_a_dashboard_search_matches_on_the_name(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    await make_dashboard(app_client, project_id=project_id, name="能耗总览")
    await make_dashboard(app_client, project_id=project_id, name="设备详情")
    response = await app_client.get(DASHBOARDS_URL, params={"q": "能耗"})
    assert [item["name"] for item in response.json()["data"]["items"]] == [
        "能耗总览"
    ]


async def test_a_listing_that_matches_nothing_returns_an_empty_page(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(DASHBOARDS_URL, params={"q": "没有这块屏"})
    assert response.json()["data"]["items"] == []
    assert response.json()["data"]["total"] == 0


async def test_a_project_listing_that_matches_nothing_is_empty(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        "/api/v1/platform/dashboard-projects", params={"q": "没有这个项目"}
    )
    assert response.json()["data"]["items"] == []


async def test_the_creation_endpoint_answers_created(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    response = await app_client.post(
        DASHBOARDS_URL, json={"project_id": project_id, "name": "主屏"}
    )
    assert response.status_code == HTTP_CREATED
