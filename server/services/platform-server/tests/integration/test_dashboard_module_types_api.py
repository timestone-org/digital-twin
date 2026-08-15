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
    assert types == {"header", "twin-view"}


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
    assert [spec["key"] for spec in module["bindings"]] == ["anchorValues"]


async def test_a_conditional_config_field_keeps_its_wire_name(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{MODULE_TYPES_URL}/header")
    title = next(
        field
        for field in data_of(response)["config_schema"]
        if field["key"] == "title"
    )
    assert title["when"] == {"key": "showTitle", "in": [True]}


async def test_an_unregistered_type_answers_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{MODULE_TYPES_URL}/gauge-chart")
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == 41012
