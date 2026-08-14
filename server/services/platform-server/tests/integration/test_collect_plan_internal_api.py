"""内部面的采集计划：服务级密钥 fail-closed，版本号是内容摘要。

守的是「密钥未配置或不符一律拒绝」与「删掉一个点位也推得下去」。
"""

import httpx
import pytest

from integration.collect_helpers import (
    PLAN,
    POINTS,
    create_points,
    create_source,
    payload,
    point_item,
)
from lib.config import load_settings
from platform_server.settings import Settings

pytestmark = pytest.mark.requires_postgres


def service_headers() -> dict[str, str]:
    """带正确服务级密钥的请求头。"""
    settings = load_settings(Settings)
    return {"X-Service-Key": settings.edge_service_key.get_secret_value()}


async def test_a_missing_service_key_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(PLAN)
    assert response.status_code == 401


async def test_an_empty_service_key_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(PLAN, headers={"X-Service-Key": ""})
    assert response.status_code == 401


async def test_a_wrong_service_key_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(PLAN, headers={"X-Service-Key": "nope"})
    assert response.status_code == 401


async def test_a_user_identity_alone_does_not_open_the_internal_face(
    app_client: httpx.AsyncClient,
) -> None:
    # 身份头默认已带全权，仍然不够——内部面挡的是「任何人」
    response = await app_client.get(PLAN)
    assert response.status_code == 401


async def test_the_plan_carries_the_source_and_its_points(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    await create_points(
        app_client,
        source["id"],
        point_item("outlet_temp"),
        point_item("inlet_temp"),
    )
    response = await app_client.get(PLAN, headers=service_headers())
    assert response.status_code == 200
    plan = payload(response)
    found = [
        item for item in plan["sources"] if item["source_id"] == source["id"]
    ]
    assert len(found) == 1
    assert found[0]["protocol"] == "opcua"
    assert found[0]["endpoint"] == source["endpoint"]
    assert found[0]["read_mode"] == "subscribe"
    codes = [point["point_code"] for point in found[0]["points"]]
    assert codes == ["inlet_temp", "outlet_temp"]


async def test_the_plan_never_carries_a_credential(
    app_client: httpx.AsyncClient,
) -> None:
    await create_source(app_client, credential="s3cr3t-p@ss")
    response = await app_client.get(PLAN, headers=service_headers())
    assert "s3cr3t" not in response.text
    assert "credential" not in response.text


async def test_a_disabled_source_is_left_out_of_the_plan(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client, is_enabled=False)
    response = await app_client.get(PLAN, headers=service_headers())
    ids = [item["source_id"] for item in payload(response)["sources"]]
    assert source["id"] not in ids


async def test_the_version_changes_when_a_point_is_added(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    before = payload(await app_client.get(PLAN, headers=service_headers()))
    await create_points(app_client, source["id"])
    after = payload(await app_client.get(PLAN, headers=service_headers()))
    assert before["version"] != after["version"]


async def test_the_version_changes_when_a_point_is_removed(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    before = payload(await app_client.get(PLAN, headers=service_headers()))
    await app_client.delete(f"{POINTS}/{batch['items'][0]['id']}")
    after = payload(await app_client.get(PLAN, headers=service_headers()))
    assert before["version"] != after["version"]


async def test_an_unchanged_plan_keeps_its_version(
    app_client: httpx.AsyncClient,
) -> None:
    await create_source(app_client)
    first = payload(await app_client.get(PLAN, headers=service_headers()))
    second = payload(await app_client.get(PLAN, headers=service_headers()))
    assert first["version"] == second["version"]


async def test_the_internal_face_stays_out_of_the_public_schema(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get("/api/v1/platform/openapi.json")
    assert PLAN not in response.json()["paths"]
