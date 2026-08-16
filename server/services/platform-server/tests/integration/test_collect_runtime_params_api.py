"""采集/归档运行参数面：读目录、写覆盖、越界拒绝、覆盖值随采集计划下发。

⚠ 分组按写权限码拆在两条路由上：/collect-runtime-params 只认采集 scope，
/runtime-params 只认大屏 scope——越界的分组名按不存在处理，否则拿大屏的码
就能改采集参数（反之亦然）。
"""

from typing import Any

import httpx
import pytest

from integration.collect_helpers import PLAN, payload
from lib.config import load_settings
from platform_server.settings import API_PREFIX, Settings

pytestmark = pytest.mark.requires_postgres

COLLECT_PARAMS_URL = f"{API_PREFIX}/collect-runtime-params"
DASHBOARD_PARAMS_URL = f"{API_PREFIX}/runtime-params"
HTTP_OK = 200
HTTP_BAD_REQUEST = 400
RUNTIME_PARAM_UNKNOWN = 41020

ARCHIVE_SECTION_URL = f"{COLLECT_PARAMS_URL}/archive"
COLLECT_SECTION_URL = f"{COLLECT_PARAMS_URL}/collect"


def items_of(response: httpx.Response) -> dict[str, dict[str, Any]]:
    """把条目按 `(分组, 键)` 索引。

    Args: response。
    """
    body: dict[str, Any] = response.json()
    return {(item["section"], item["key"]): item for item in list(body["data"])}


def service_headers() -> dict[str, str]:
    """内部计划端点要的服务级密钥头。"""
    settings = load_settings(Settings)
    return {"X-Service-Key": settings.edge_service_key.get_secret_value()}


async def test_the_collect_face_lists_both_sections(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(COLLECT_PARAMS_URL)
    assert response.status_code == HTTP_OK
    keys = set(items_of(response))
    assert ("collect", "snapshot_flush_interval_ms") in keys
    assert ("archive", "enabled") in keys
    # 大屏分组绝不该从这条路由漏出来
    assert all(section != "dashboard" for section, _ in keys)


async def test_the_dashboard_face_never_leaks_collect_sections(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(DASHBOARD_PARAMS_URL)
    assert response.status_code == HTTP_OK
    assert all(
        item["section"] == "dashboard" for item in list(response.json()["data"])
    )


async def test_a_collect_section_is_unknown_to_the_dashboard_face(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.put(
        f"{DASHBOARD_PARAMS_URL}/archive", json={"values": {"enabled": False}}
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert response.json()["code"] == RUNTIME_PARAM_UNKNOWN


async def test_a_dashboard_section_is_unknown_to_the_collect_face(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.put(
        f"{COLLECT_PARAMS_URL}/dashboard",
        json={"values": {"publish_window_ms": 500}},
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert response.json()["code"] == RUNTIME_PARAM_UNKNOWN


async def test_an_override_travels_with_the_plan(
    app_client: httpx.AsyncClient,
) -> None:
    before = payload(await app_client.get(PLAN, headers=service_headers()))
    written = await app_client.put(
        ARCHIVE_SECTION_URL, json={"values": {"enabled": False}}
    )
    assert written.status_code == HTTP_OK
    after = payload(await app_client.get(PLAN, headers=service_headers()))
    assert after["params"]["archive"]["enabled"] is False
    # 拨一个旋钮就该触发一次重新收敛
    assert after["version"] != before["version"]


async def test_reset_takes_the_override_out_of_the_plan(
    app_client: httpx.AsyncClient,
) -> None:
    await app_client.put(
        ARCHIVE_SECTION_URL, json={"values": {"enabled": False}}
    )
    reset = await app_client.post(f"{ARCHIVE_SECTION_URL}:reset")
    assert reset.status_code == HTTP_OK
    plan = payload(await app_client.get(PLAN, headers=service_headers()))
    assert "archive" not in plan["params"]


async def test_a_number_is_refused_where_a_switch_is_expected(
    app_client: httpx.AsyncClient,
) -> None:
    # bool 是 int 的子类：这里不拦，`1` 会一路走到采集侧被当成「没覆盖」
    response = await app_client.put(
        ARCHIVE_SECTION_URL, json={"values": {"enabled": 1}}
    )
    assert response.status_code == HTTP_BAD_REQUEST


async def test_an_out_of_range_value_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.put(
        COLLECT_SECTION_URL,
        json={"values": {"snapshot_flush_interval_ms": 1}},
    )
    assert response.status_code == HTTP_BAD_REQUEST


async def test_every_item_carries_tier_and_danger(
    app_client: httpx.AsyncClient,
) -> None:
    # 非即时档要在界面上如实说「还没生效」，危险方向要求二次确认——
    # 这两个字段缺了，前端只能把这些话写死
    response = await app_client.get(COLLECT_PARAMS_URL)
    items = items_of(response)
    assert items[("collect", "heartbeat_interval_s")]["tier"] == "reconnect"
    assert items[("archive", "enabled")]["danger"] == "off"
    assert items[("archive", "enabled")]["env_name"] == (
        "COLLECT_ARCHIVE_ENABLED"
    )
