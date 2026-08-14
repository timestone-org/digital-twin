"""项目自定义主题面：增删改查，以及删主题不联动改屏。"""

import uuid
from typing import Any

import httpx
import pytest

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    PROJECTS_URL,
    data_of,
    make_dashboard,
    make_project,
)

pytestmark = pytest.mark.requires_postgres

HTTP_OK = 200
# ⚠ 是 400 不是 422：`lib.errors.handlers` 把 FastAPI 的 RequestValidationError
# 也归一到 `ValidationFailed.http_status`，全服务只有这一个校验失败状态码
HTTP_VALUE_REJECTED = 400
PROJECT_NOT_FOUND = 41001
THEME_NOT_FOUND = 41019
TOKENS: dict[str, Any] = {"surface": {"base": "#0b1220"}}


def themes_url(project_id: str) -> str:
    """一个项目的主题集合地址。

    Args: project_id。
    """
    return f"{PROJECTS_URL}/{project_id}/themes"


def items_of(response: httpx.Response) -> list[dict[str, Any]]:
    """取信封里的 `data` 数组。

    Args: response。
    """
    body: dict[str, Any] = response.json()
    return list(body["data"])


async def make_theme(
    client: httpx.AsyncClient, project_id: str, name: str = "夜航"
) -> dict[str, Any]:
    """建一套主题并回它的形态。

    Args: client, project_id, name。
    """
    response = await client.post(
        themes_url(project_id),
        json={"name": name, "mode": "dark", "tokens": TOKENS},
    )
    assert response.status_code == HTTP_CREATED
    return data_of(response)


async def test_a_new_project_starts_with_no_custom_themes(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    response = await app_client.get(themes_url(project_id))
    assert items_of(response) == []


async def test_a_created_theme_shows_up_in_the_list(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    created = await make_theme(app_client, project_id)
    listed = items_of(await app_client.get(themes_url(project_id)))
    assert [item["id"] for item in listed] == [created["id"]]


async def test_the_stored_tokens_come_back_unchanged(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    created = await make_theme(app_client, project_id)
    assert created["tokens"] == TOKENS


async def test_two_themes_both_survive_being_added_one_after_another(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 整组读→改→整组写：第二次写要看得见第一次的结果，否则先加的那套会被
    # 悄悄盖掉，而两次请求都是 201
    project_id = await make_project(app_client)
    first = await make_theme(app_client, project_id, "甲")
    second = await make_theme(app_client, project_id, "乙")
    listed = items_of(await app_client.get(themes_url(project_id)))
    assert [item["id"] for item in listed] == [first["id"], second["id"]]


async def test_renaming_a_theme_leaves_its_tokens_alone(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    created = await make_theme(app_client, project_id)
    response = await app_client.patch(
        f"{themes_url(project_id)}/{created['id']}", json={"name": "晨曦"}
    )
    assert data_of(response)["name"] == "晨曦"
    assert data_of(response)["tokens"] == TOKENS


async def test_changing_one_theme_leaves_its_neighbour_alone(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    kept = await make_theme(app_client, project_id, "甲")
    changed = await make_theme(app_client, project_id, "乙")
    await app_client.patch(
        f"{themes_url(project_id)}/{changed['id']}", json={"mode": "light"}
    )
    listed = items_of(await app_client.get(themes_url(project_id)))
    assert listed[0] == kept


async def test_a_deleted_theme_leaves_the_list(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    created = await make_theme(app_client, project_id)
    removed = await app_client.delete(
        f"{themes_url(project_id)}/{created['id']}"
    )
    assert removed.status_code == HTTP_NO_CONTENT
    assert items_of(await app_client.get(themes_url(project_id))) == []


async def test_deleting_a_theme_does_not_touch_the_screens_using_it(
    app_client: httpx.AsyncClient,
) -> None:
    # 删一套配色不该悄悄改写别人正在展播的画面：屏照常在，配置一字未动
    project_id = await make_project(app_client)
    created = await make_theme(app_client, project_id)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    await app_client.patch(
        f"{DASHBOARDS_URL}/{dashboard['id']}",
        json={"theme_json": {"theme_id": created["id"]}},
    )
    await app_client.delete(f"{themes_url(project_id)}/{created['id']}")
    after = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    assert after.status_code == HTTP_OK
    assert data_of(after)["theme_json"] == {"theme_id": created["id"]}


async def test_a_missing_theme_answers_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    response = await app_client.delete(
        f"{themes_url(project_id)}/{uuid.uuid4()}"
    )
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == THEME_NOT_FOUND


async def test_themes_of_a_missing_project_answer_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(themes_url(str(uuid.uuid4())))
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == PROJECT_NOT_FOUND


async def test_an_unknown_mode_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    response = await app_client.post(
        themes_url(project_id),
        json={"name": "夜航", "mode": "twilight", "tokens": {}},
    )
    assert response.status_code == HTTP_VALUE_REJECTED


async def test_an_explicit_null_name_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    created = await make_theme(app_client, project_id)
    response = await app_client.patch(
        f"{themes_url(project_id)}/{created['id']}", json={"name": None}
    )
    assert response.status_code == HTTP_VALUE_REJECTED
