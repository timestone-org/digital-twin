"""项目面：增删改查、幂等键、404 覆盖「不存在」、非空项目拒删。"""

import uuid

import httpx
import pytest

from integration.dashboard_helpers import (
    HTTP_CONFLICT,
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    PROJECTS_URL,
    data_of,
    make_dashboard,
    make_project,
)

pytestmark = pytest.mark.requires_postgres


async def test_a_created_project_comes_back_with_zero_dashboards(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(PROJECTS_URL, json={"name": "光伏一期"})
    assert response.status_code == HTTP_CREATED
    assert data_of(response)["dashboard_count"] == 0


async def test_creation_answers_with_a_location_header(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(PROJECTS_URL, json={"name": "光伏一期"})
    project_id = data_of(response)["id"]
    assert response.headers["Location"] == f"{PROJECTS_URL}/{project_id}"


async def test_the_same_idempotency_key_creates_one_project(
    app_client: httpx.AsyncClient,
) -> None:
    headers = {"Idempotency-Key": "project-once"}
    first = await app_client.post(
        PROJECTS_URL, json={"name": "光伏一期"}, headers=headers
    )
    second = await app_client.post(
        PROJECTS_URL, json={"name": "光伏一期"}, headers=headers
    )
    assert data_of(first)["id"] == data_of(second)["id"]


async def test_a_missing_project_answers_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{PROJECTS_URL}/{uuid.uuid4()}")
    assert response.status_code == HTTP_NOT_FOUND


async def test_the_not_found_body_carries_the_domain_error_code(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{PROJECTS_URL}/{uuid.uuid4()}")
    assert response.json()["code"] == 41001


async def test_a_patch_only_touches_the_fields_it_carries(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client, "光伏一期")
    response = await app_client.patch(
        f"{PROJECTS_URL}/{project_id}", json={"description": "第一期"}
    )
    assert data_of(response)["name"] == "光伏一期"
    assert data_of(response)["description"] == "第一期"


async def test_a_project_listing_counts_its_dashboards(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client, "光伏一期")
    await make_dashboard(app_client, project_id=project_id)
    response = await app_client.get(PROJECTS_URL, params={"q": "光伏"})
    items = response.json()["data"]["items"]
    assert [item["dashboard_count"] for item in items] == [1]


async def test_a_project_with_dashboards_refuses_to_be_deleted(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    await make_dashboard(app_client, project_id=project_id)
    response = await app_client.delete(f"{PROJECTS_URL}/{project_id}")
    assert response.status_code == HTTP_CONFLICT
    assert response.json()["code"] == 41008


async def test_an_empty_project_deletes_cleanly(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    response = await app_client.delete(f"{PROJECTS_URL}/{project_id}")
    assert response.status_code == HTTP_NO_CONTENT


async def test_an_unsupported_sort_field_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(PROJECTS_URL, params={"sort": "theme_json"})
    assert response.status_code == 400


@pytest.mark.parametrize("field", ["name", "theme_json", "brand_json"])
async def test_a_null_on_a_non_nullable_field_is_refused(
    app_client: httpx.AsyncClient, field: str
) -> None:
    # ⚠ 不在入参层拦就一路走到 NOT NULL 违例：对外是 500，日志里是一条
    # unhandled_exception，而用户只是在 PATCH 里把一个字段写成了 null
    project_id = await make_project(app_client)
    response = await app_client.patch(
        f"{PROJECTS_URL}/{project_id}", json={field: None}
    )
    assert response.status_code == 400


async def test_a_null_on_a_nullable_field_clears_it(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    await app_client.patch(
        f"{PROJECTS_URL}/{project_id}", json={"description": "第一期"}
    )
    response = await app_client.patch(
        f"{PROJECTS_URL}/{project_id}", json={"description": None}
    )
    assert data_of(response)["description"] is None
