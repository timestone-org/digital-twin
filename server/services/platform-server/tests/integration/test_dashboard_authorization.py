"""大屏面的闸 2：没签名的请求一律 401，权限不够一律 403。

⚠ 闸 1 在边缘执行，绕过边缘直连端口时它不生效；这几条守的是贴着代码的那一道。
"""

import httpx
import pytest
from conftest import SignHeaders

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    MODULE_TYPES_URL,
    PROJECTS_URL,
)
from platform_server.apps.dashboard.catalog import (
    DASHBOARD_EDIT,
    DASHBOARD_VIEW,
)

pytestmark = pytest.mark.requires_postgres

HTTP_OK = 200
HTTP_UNAUTHENTICATED = 401
HTTP_FORBIDDEN = 403
MISSING_ID = "00000000-0000-7000-8000-000000000000"


async def test_a_request_without_a_signature_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        MODULE_TYPES_URL, headers={"X-Auth-Sig": ""}
    )
    assert response.status_code == HTTP_UNAUTHENTICATED
    assert response.json()["code"] == 40100


async def test_forged_identity_headers_are_refused(
    app_client: httpx.AsyncClient,
) -> None:
    # 直接编一组头：没有签名就没有身份，权限码写成什么都不作数
    forged = {
        "X-Auth-User-Id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "X-Auth-Role": "admin",
        "X-Auth-Permissions": "W10",
        "X-Auth-Exp": "99999999999",
        "X-Auth-Sig": "0" * 64,
    }
    response = await app_client.post(
        PROJECTS_URL, json={"name": "伪造项目"}, headers=forged
    )
    assert response.status_code == HTTP_UNAUTHENTICATED


async def test_a_viewer_cannot_create_a_project(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.post(
        PROJECTS_URL, json={"name": "光伏"}, headers=sign([DASHBOARD_VIEW])
    )
    assert response.status_code == HTTP_FORBIDDEN
    assert response.json()["code"] == 40106


async def test_an_editor_cannot_delete_a_dashboard(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.delete(
        f"{DASHBOARDS_URL}/{MISSING_ID}",
        headers=sign([DASHBOARD_VIEW, DASHBOARD_EDIT]),
    )
    assert response.status_code == HTTP_FORBIDDEN


async def test_a_viewer_can_read_the_module_catalog(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.get(
        MODULE_TYPES_URL, headers=sign([DASHBOARD_VIEW])
    )
    assert response.status_code == HTTP_OK
