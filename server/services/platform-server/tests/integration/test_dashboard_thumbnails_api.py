"""缩略图面：写入、回读、超限 413、缺图 404、随大屏一并消失。"""

import uuid

import httpx
import pytest

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    data_of,
    make_dashboard,
    make_project,
)
from platform_server.apps.dashboard.models.thumbnail import (
    MAX_THUMBNAIL_CHARS,
)

pytestmark = pytest.mark.requires_postgres

HTTP_OK = 200
HTTP_PAYLOAD_TOO_LARGE = 413
PREFIX = "data:image/png;base64,"
SHOT = f"{PREFIX}AAAA"
ANOTHER_SHOT = f"{PREFIX}BBBB"
THUMBNAIL_NOT_FOUND = 41017
THUMBNAIL_TOO_LARGE = 41018
DASHBOARD_NOT_FOUND = 41002


def thumbnail_url(dashboard_id: str) -> str:
    """一张屏的缩略图地址。

    Args: dashboard_id。
    """
    return f"{DASHBOARDS_URL}/{dashboard_id}/thumbnail"


async def make_screen(client: httpx.AsyncClient) -> str:
    """建一个项目与一张屏，回大屏 id。

    Args: client。
    """
    project_id = await make_project(client)
    dashboard = await make_dashboard(client, project_id=project_id)
    return str(dashboard["id"])


async def test_a_stored_thumbnail_reads_back_unchanged(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    await app_client.put(thumbnail_url(dashboard_id), json={"data": SHOT})
    response = await app_client.get(thumbnail_url(dashboard_id))
    assert data_of(response)["data"] == SHOT


async def test_writing_twice_replaces_the_picture(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 第二次写走的是 ON CONFLICT：先查再插会在这里撞主键回 500
    dashboard_id = await make_screen(app_client)
    await app_client.put(thumbnail_url(dashboard_id), json={"data": SHOT})
    second = await app_client.put(
        thumbnail_url(dashboard_id), json={"data": ANOTHER_SHOT}
    )
    assert second.status_code == HTTP_OK
    assert data_of(second)["data"] == ANOTHER_SHOT


async def test_a_screen_without_a_picture_answers_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    response = await app_client.get(thumbnail_url(dashboard_id))
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == THUMBNAIL_NOT_FOUND


async def test_a_missing_screen_is_told_apart_from_a_missing_picture(
    app_client: httpx.AsyncClient,
) -> None:
    # 前端据这两个码分派：缺图显示占位，缺屏把整张卡片撤掉
    response = await app_client.get(thumbnail_url(str(uuid.uuid4())))
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == DASHBOARD_NOT_FOUND


async def test_an_oversized_picture_is_refused_with_payload_too_large(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    oversized = PREFIX + "A" * (MAX_THUMBNAIL_CHARS - len(PREFIX) + 1)
    response = await app_client.put(
        thumbnail_url(dashboard_id), json={"data": oversized}
    )
    assert response.status_code == HTTP_PAYLOAD_TOO_LARGE
    assert response.json()["code"] == THUMBNAIL_TOO_LARGE


async def test_a_picture_at_the_limit_still_goes_in(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    exact = PREFIX + "A" * (MAX_THUMBNAIL_CHARS - len(PREFIX))
    response = await app_client.put(
        thumbnail_url(dashboard_id), json={"data": exact}
    )
    assert response.status_code == HTTP_OK


async def test_writing_to_a_missing_screen_answers_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.put(
        thumbnail_url(str(uuid.uuid4())), json={"data": SHOT}
    )
    assert response.status_code == HTTP_NOT_FOUND


async def test_deleting_the_screen_takes_the_picture_with_it(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard_id = await make_screen(app_client)
    await app_client.put(thumbnail_url(dashboard_id), json={"data": SHOT})
    removed = await app_client.delete(f"{DASHBOARDS_URL}/{dashboard_id}")
    assert removed.status_code == HTTP_NO_CONTENT
    response = await app_client.get(thumbnail_url(dashboard_id))
    assert response.status_code == HTTP_NOT_FOUND
