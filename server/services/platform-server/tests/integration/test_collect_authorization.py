"""闸 2：每条采集面端点自己判权限码，绕过边缘直连端口时它照样生效。

守的是「读、改配置、碰现场」三档不许互相顶替。
"""

import httpx
import pytest
from conftest import SignHeaders

from integration.collect_helpers import (
    HISTORIES,
    POINTS,
    SOURCES,
    create_points,
    create_source,
    source_body,
)
from platform_server.apps.collect.catalog import (
    COLLECT_MANAGE,
    COLLECT_OPERATE,
    COLLECT_VIEW,
)

pytestmark = pytest.mark.requires_postgres


async def test_reading_sources_needs_the_view_code(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.get(SOURCES, headers=sign([COLLECT_MANAGE]))
    assert response.status_code == 403


async def test_the_view_code_alone_cannot_create_a_source(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.post(
        SOURCES, json=source_body(), headers=sign([COLLECT_VIEW])
    )
    assert response.status_code == 403


async def test_the_manage_code_cannot_touch_the_field(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    source = await create_source(app_client)
    response = await app_client.post(
        f"{SOURCES}/{source['id']}:test", headers=sign([COLLECT_MANAGE])
    )
    assert response.status_code == 403


async def test_the_operate_code_cannot_change_the_configuration(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.post(
        SOURCES, json=source_body(), headers=sign([COLLECT_OPERATE])
    )
    assert response.status_code == 403


async def test_writing_a_value_needs_the_operate_code(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    response = await app_client.post(
        f"{POINTS}/{batch['items'][0]['id']}:write",
        json={"value": 1},
        headers={
            **sign([COLLECT_MANAGE]),
            "Idempotency-Key": "write-guard-1",
        },
    )
    assert response.status_code == 403


async def test_reading_history_needs_the_view_code(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.get(
        HISTORIES,
        params={
            "node_keys": ["0192f0c0-0000-7000-8000-00000000abcd:outlet_temp"],
            "range_start": "2026-08-01T00:00:00Z",
            "range_end": "2026-08-02T00:00:00Z",
        },
        headers=sign([COLLECT_OPERATE]),
    )
    assert response.status_code == 403


async def test_an_unsigned_caller_is_unauthenticated(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        SOURCES, headers={"X-Auth-User-Id": "", "X-Auth-Sig": ""}
    )
    assert response.status_code == 401


async def test_a_dashboard_only_caller_cannot_read_sources(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.get(SOURCES, headers=sign(["dashboard:view"]))
    assert response.status_code == 403
