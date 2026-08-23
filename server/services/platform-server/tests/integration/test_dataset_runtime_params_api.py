"""台账采集那一组运行参数：读默认、写覆盖、`:reset` 全组恢复，以及两个码。

⚠ 这条路由挂在 `dataset-tables/` 之下，与 `GET /dataset-tables/{table_id}` 只差
一个字面量段。登记顺序反了的话 `runtime-params` 会先落到那个 UUID 路径参数上
并当场 422——而 422 看起来像「客户端传错了」，不像「路由登记反了」。
"""

from typing import Any

import httpx
import pytest
from conftest import SignHeaders

from platform_server.apps.dataset.catalog import DATASET_MANAGE, DATASET_VIEW
from platform_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

RUNTIME_PARAMS_URL = f"{API_PREFIX}/dataset-tables/runtime-params"
SECTION_URL = f"{RUNTIME_PARAMS_URL}/dataset"
RESET_URL = f"{RUNTIME_PARAMS_URL}/dataset:reset"
HTTP_OK = 200
HTTP_BAD_REQUEST = 400
HTTP_FORBIDDEN = 403
RUNTIME_PARAM_UNKNOWN = 41020
SWITCH_KEY = "dataset_enabled"
EXPECTED_KEYS = {
    "dataset_enabled",
    "dataset_interval_s",
    "dataset_recompute_tail_buckets",
    "dataset_max_buckets_per_tick",
    "dataset_table_timeout_s",
}


def items_of(response: httpx.Response) -> dict[str, dict[str, Any]]:
    """把条目按键索引。

    Args: response。
    """
    body: dict[str, Any] = response.json()
    return {item["key"]: item for item in body["data"]}


async def test_the_group_lists_exactly_the_collector_knobs(
    app_client: httpx.AsyncClient,
) -> None:
    # 这一条同时证明路由没被 `{table_id}` 吞掉：吞掉的话这里是一条 422
    response = await app_client.get(RUNTIME_PARAMS_URL)

    assert response.status_code == HTTP_OK, response.text
    assert set(items_of(response)) == EXPECTED_KEYS


async def test_the_switch_says_which_direction_is_dangerous(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 危险方向是**关**：关掉之后水位停在原地、完全没有报错
    response = await app_client.get(RUNTIME_PARAMS_URL)

    switch = items_of(response)[SWITCH_KEY]
    assert switch["kind"] == "switch"
    assert switch["danger"] == "off"
    assert switch["env_name"] == "PLATFORM_DATASET_ENABLED"
    assert switch["write_code"] == DATASET_MANAGE


async def test_turning_the_collector_on_sticks(
    app_client: httpx.AsyncClient,
) -> None:
    written = await app_client.put(
        SECTION_URL, json={"values": {SWITCH_KEY: True}}
    )
    assert written.status_code == HTTP_OK, written.text

    reread = items_of(await app_client.get(RUNTIME_PARAMS_URL))[SWITCH_KEY]
    assert reread["value"] is True
    assert reread["is_overridden"] is True
    # ⚠ 出厂值仍然是环境变量给的那个：环境变量是永久默认值而不是一次性播种
    assert reread["default_value"] is False


async def test_resetting_the_group_puts_it_back_on_the_environment(
    app_client: httpx.AsyncClient,
) -> None:
    await app_client.put(SECTION_URL, json={"values": {SWITCH_KEY: True}})

    reset = await app_client.post(RESET_URL)

    assert reset.status_code == HTTP_OK, reset.text
    switch = items_of(reset)[SWITCH_KEY]
    assert switch["is_overridden"] is False
    assert switch["value"] == switch["default_value"]


async def test_a_number_is_refused_where_a_switch_is_expected(
    app_client: httpx.AsyncClient,
) -> None:
    # 越界与类型不符一律拒绝，**不静默夹到边界**
    response = await app_client.put(
        SECTION_URL, json={"values": {SWITCH_KEY: 1}}
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert response.json()["code"] == 40001


async def test_another_groups_name_is_not_reachable_from_here(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 分组按写权限码拆在三条路由上：越界的分组名按不存在处理，否则拿台账的
    # 码就能改大屏的推送节拍
    response = await app_client.put(
        f"{RUNTIME_PARAMS_URL}/dashboard",
        json={"values": {"publish_window_ms": 3000}},
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert response.json()["code"] == RUNTIME_PARAM_UNKNOWN


async def test_reading_the_knobs_needs_the_view_code(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.get(
        RUNTIME_PARAMS_URL, headers=sign([DATASET_MANAGE])
    )

    assert response.status_code == HTTP_FORBIDDEN


async def test_the_view_code_alone_cannot_flip_the_switch(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    # 看得见节拍不等于能改，故读写分两个码
    response = await app_client.put(
        SECTION_URL,
        json={"values": {SWITCH_KEY: True}},
        headers=sign([DATASET_VIEW]),
    )

    assert response.status_code == HTTP_FORBIDDEN
