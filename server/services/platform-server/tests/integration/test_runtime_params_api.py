"""运行参数面：读默认、写覆盖、改回默认即删行、`:reset` 全组恢复。

⚠ 断言一律拿响应里的 `default_value` 当基准而不是写死数字：默认值来自部署的
环境变量，写死就变成「在我这台机器上是绿的」。
"""

from typing import Any

import httpx
import pytest

from platform_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

RUNTIME_PARAMS_URL = f"{API_PREFIX}/runtime-params"
DASHBOARD_SECTION_URL = f"{RUNTIME_PARAMS_URL}/dashboard"
RESET_URL = f"{RUNTIME_PARAMS_URL}/dashboard:reset"
HTTP_OK = 200
HTTP_BAD_REQUEST = 400
# ⚠ 是 400 不是 422：本仓 `lib.errors.ValidationFailed` 统一映到 400，
# 全服务同一口径。FastAPI 自己的请求体校验失败走 422，两者错误码同为 40001，
# 差别只在状态码——想统一得改 lib，那是全服务的对外契约变更，不在本轮
HTTP_VALUE_REJECTED = 400
RUNTIME_PARAM_UNKNOWN = 41020
WINDOW_KEY = "publish_window_ms"
EXPECTED_KEYS = {
    "publish_window_ms",
    "publish_max_items",
    "publish_stale_after_ms",
    "publish_reconcile_interval_s",
}


def rows_of(response: httpx.Response) -> list[dict[str, Any]]:
    """取信封里的条目数组。

    Args: response。
    """
    body: dict[str, Any] = response.json()
    return list(body["data"])


def items_of(response: httpx.Response) -> dict[str, dict[str, Any]]:
    """把条目按键索引。

    Args: response。
    """
    return {item["key"]: item for item in rows_of(response)}


async def read_dashboard_section(
    client: httpx.AsyncClient,
) -> dict[str, dict[str, Any]]:
    """读 dashboard 分组此刻的全部条目。

    Args: client。
    """
    response = await client.get(
        RUNTIME_PARAMS_URL, params={"section": "dashboard"}
    )
    assert response.status_code == HTTP_OK
    return items_of(response)


async def test_the_dashboard_section_lists_exactly_the_registered_knobs(
    app_client: httpx.AsyncClient,
) -> None:
    items = await read_dashboard_section(app_client)
    assert set(items) == EXPECTED_KEYS


async def test_an_untouched_knob_reports_the_environment_default(
    app_client: httpx.AsyncClient,
) -> None:
    item = (await read_dashboard_section(app_client))[WINDOW_KEY]
    assert item["value"] == item["default_value"]
    assert item["is_overridden"] is False
    assert item["updated_at"] is None


async def test_every_knob_carries_the_environment_variable_name(
    app_client: httpx.AsyncClient,
) -> None:
    items = await read_dashboard_section(app_client)
    assert items[WINDOW_KEY]["env_name"] == "PLATFORM_PUBLISH_WINDOW_MS"


async def test_the_catalog_never_exposes_a_secret(
    app_client: httpx.AsyncClient,
) -> None:
    # 没登记的键既不可读也不可写，密钥因此天然不在目录里
    items = await read_dashboard_section(app_client)
    assert "edge_signing_secret" not in items


async def test_a_written_value_becomes_the_effective_one(
    app_client: httpx.AsyncClient,
) -> None:
    before = (await read_dashboard_section(app_client))[WINDOW_KEY]
    wanted = int(before["default_value"]) + 100
    response = await app_client.put(
        DASHBOARD_SECTION_URL, json={"values": {WINDOW_KEY: wanted}}
    )
    assert response.status_code == HTTP_OK
    after = items_of(response)[WINDOW_KEY]
    assert after["value"] == wanted
    assert after["is_overridden"] is True
    assert after["default_value"] == before["default_value"]


async def test_a_written_value_is_still_there_on_the_next_read(
    app_client: httpx.AsyncClient,
) -> None:
    before = (await read_dashboard_section(app_client))[WINDOW_KEY]
    wanted = int(before["default_value"]) + 100
    await app_client.put(
        DASHBOARD_SECTION_URL, json={"values": {WINDOW_KEY: wanted}}
    )
    after = (await read_dashboard_section(app_client))[WINDOW_KEY]
    assert after["value"] == wanted
    assert after["updated_by"]


async def test_writing_one_knob_leaves_its_neighbours_alone(
    app_client: httpx.AsyncClient,
) -> None:
    before = await read_dashboard_section(app_client)
    wanted = int(before[WINDOW_KEY]["default_value"]) + 100
    await app_client.put(
        DASHBOARD_SECTION_URL, json={"values": {WINDOW_KEY: wanted}}
    )
    after = await read_dashboard_section(app_client)
    untouched = [
        key
        for key in EXPECTED_KEYS - {WINDOW_KEY}
        if after[key]["is_overridden"]
    ]
    assert untouched == []


async def test_writing_the_default_back_stops_the_override(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 存一行与默认值相等的覆盖，这一项就从此不再跟随环境变量，而界面上
    # 看不出任何区别
    before = (await read_dashboard_section(app_client))[WINDOW_KEY]
    await app_client.put(
        DASHBOARD_SECTION_URL,
        json={"values": {WINDOW_KEY: int(before["default_value"]) + 100}},
    )
    await app_client.put(
        DASHBOARD_SECTION_URL,
        json={"values": {WINDOW_KEY: before["default_value"]}},
    )
    after = (await read_dashboard_section(app_client))[WINDOW_KEY]
    assert after["is_overridden"] is False


async def test_reset_puts_the_whole_group_back_on_the_environment(
    app_client: httpx.AsyncClient,
) -> None:
    before = (await read_dashboard_section(app_client))[WINDOW_KEY]
    await app_client.put(
        DASHBOARD_SECTION_URL,
        json={"values": {WINDOW_KEY: int(before["default_value"]) + 100}},
    )
    response = await app_client.post(RESET_URL)
    assert response.status_code == HTTP_OK
    overridden = [
        key for key, item in items_of(response).items() if item["is_overridden"]
    ]
    assert overridden == []


async def test_an_unregistered_key_is_turned_away(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.put(
        DASHBOARD_SECTION_URL, json={"values": {"postgres_host": 1}}
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert response.json()["code"] == RUNTIME_PARAM_UNKNOWN


async def test_an_unregistered_section_is_turned_away(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.put(
        f"{RUNTIME_PARAMS_URL}/opcua", json={"values": {WINDOW_KEY: 1000}}
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert response.json()["code"] == RUNTIME_PARAM_UNKNOWN


async def test_reading_an_unregistered_section_is_turned_away(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        RUNTIME_PARAMS_URL, params={"section": "opcua"}
    )
    assert response.status_code == HTTP_BAD_REQUEST


async def test_a_value_outside_the_declared_range_is_turned_away(
    app_client: httpx.AsyncClient,
) -> None:
    items = await read_dashboard_section(app_client)
    beyond = int(items[WINDOW_KEY]["maximum"]) + 1
    response = await app_client.put(
        DASHBOARD_SECTION_URL, json={"values": {WINDOW_KEY: beyond}}
    )
    assert response.status_code == HTTP_VALUE_REJECTED


async def test_an_empty_write_is_turned_away(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.put(DASHBOARD_SECTION_URL, json={"values": {}})
    assert response.status_code == HTTP_VALUE_REJECTED


async def test_listing_without_a_filter_answers_every_section(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(RUNTIME_PARAMS_URL)
    names = {row["section"] for row in rows_of(response)}
    assert names == {"dashboard"}


async def test_every_item_declares_the_code_needed_to_write_it(
    app_client: httpx.AsyncClient,
) -> None:
    # 界面据它决定「保存」按钮亮不亮，写死在前端就会与闸 1 漂开
    response = await app_client.get(RUNTIME_PARAMS_URL)
    codes = {row["write_code"] for row in rows_of(response)}
    assert codes == {"dashboard:edit"}


async def test_an_override_records_what_the_value_was_before(
    app_client: httpx.AsyncClient,
) -> None:
    before = (await read_dashboard_section(app_client))[WINDOW_KEY]
    await app_client.put(
        DASHBOARD_SECTION_URL,
        json={"values": {WINDOW_KEY: int(before["default_value"]) + 100}},
    )
    after = (await read_dashboard_section(app_client))[WINDOW_KEY]
    assert after["previous_value"] == before["default_value"]


async def test_an_untouched_item_has_no_previous_value(
    app_client: httpx.AsyncClient,
) -> None:
    item = (await read_dashboard_section(app_client))[WINDOW_KEY]
    assert item["previous_value"] is None
