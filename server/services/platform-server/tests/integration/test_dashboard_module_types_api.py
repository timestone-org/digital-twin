"""模块清单面：Agent 靠它知道有哪些模块、每个吃什么配置、有几个绑定槽。"""

import httpx
import pytest

from integration.dashboard_helpers import (
    HTTP_NOT_FOUND,
    MODULE_TYPES_URL,
    data_of,
)

pytestmark = pytest.mark.requires_postgres


async def test_the_listing_names_every_registered_module(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(MODULE_TYPES_URL)
    types = {item["type"] for item in data_of(response)["modules"]}
    # ⚠ 清单的真源在前端，这里是逐字副本（module_catalog.py 文件头）。加模块要
    # 同步改这条：它是 Agent 看得见的对外契约，静默变长等于契约无人把关
    assert types == {
        "action-button",
        "container",
        "data-card",
        "footer",
        "gauge-card",
        "header",
        "image-block",
        "info-card",
        "info-feed",
        "info-list",
        "metric-card",
        "text-block",
        "twin-2d-view",
        "twin-view",
    }


async def test_the_listing_carries_the_catalog_version(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(MODULE_TYPES_URL)
    assert data_of(response)["catalog_version"] == 1


async def test_a_single_module_carries_its_config_and_slots(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{MODULE_TYPES_URL}/twin-view")
    module = data_of(response)
    assert module["display_name"] == "数字孪生"
    assert module["default_size"] == {
        "width": 1280,
        "height": 720,
        "min_width": 320,
        "min_height": 240,
    }
    # 逐字列全：槽多一个少一个都得在这里改，免得清单悄悄漂了没人知道
    assert [spec["key"] for spec in module["bindings"]] == [
        "partValues",
        "anchorValues",
        "panelValues",
        "arrowValues",
        "flowValues",
        "partFieldValues",
    ]


def _config_field(response: httpx.Response, key: str) -> dict[str, object]:
    """按 key 取一个配置项。

    ⚠ 不许写成裸 `next(...)`：生成器空了会在协程里抛 StopIteration，asyncio 把
    它翻译成 `RuntimeError: coroutine raised StopIteration`，报错栈指向事件循环
    内部，完全看不出真正的原因是「清单里这个字段被删了」。
    """
    fields = data_of(response)["config_schema"]
    found = [field for field in fields if field["key"] == key]
    assert found, f"config_schema 里没有 {key}"
    return found[0]


async def test_a_conditional_config_field_keeps_its_wire_name(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{MODULE_TYPES_URL}/container")
    title = _config_field(response, "title")
    assert title["when"] == {"key": "showTitle", "in": [True]}


async def test_an_unregistered_type_answers_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{MODULE_TYPES_URL}/gauge-chart")
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == 41012
