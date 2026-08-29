"""卡片样式库：建、列、改、删的回路，与三条指到字段的校验。

⚠ 三条校验守的都是**静默失效**：模块类型认不出、外壳键写错、内容键混进内芯，
三种情况若放行，值都存得下去、渲染时静默不生效——套用的人只看到「存下来的
样式套上去少了一半」，而两侧都不报错。
"""

from typing import Any

import httpx
import pytest

from integration.dashboard_helpers import (
    HTTP_BAD_REQUEST,
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    data_of,
    details_of,
    issue_fields,
)
from platform_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

CARD_STYLES_URL = f"{API_PREFIX}/card-styles"
MISSING_ID = "00000000-0000-7000-8000-000000000000"
CARD_STYLE_NOT_FOUND = 41021
CARD_STYLE_INVALID = 41022
# 真实存在的外壳键与 `metric-card` 的观感键，取自提交进仓的模块清单
CHROME = {"borderStyle": "glow", "radius": 4, "showTitle": True}
METRIC_LOOK = {"layout": "grid", "columns": 2, "valueSize": 0}


def page_of(response: httpx.Response) -> list[dict[str, Any]]:
    """取分页信封里的 `items`。

    Args: response。
    """
    items = data_of(response)["items"]
    assert isinstance(items, list)
    return items


async def make_style(
    client: httpx.AsyncClient, **overrides: Any
) -> dict[str, Any]:
    """存一条样式并回它的详情。缺省是一条通用外壳样式。

    Args: client, overrides。
    """
    body: dict[str, Any] = {"name": "极简描边", "chrome_json": CHROME}
    body.update(overrides)
    response = await client.post(CARD_STYLES_URL, json=body)
    assert response.status_code == HTTP_CREATED, response.text
    return data_of(response)


async def reject(client: httpx.AsyncClient, **overrides: Any) -> httpx.Response:
    """发一条建样式请求并断言它被 400 拒掉。

    Args: client, overrides。
    """
    body: dict[str, Any] = {"name": "坏样式", "chrome_json": {}}
    body.update(overrides)
    response = await client.post(CARD_STYLES_URL, json=body)
    assert response.status_code == HTTP_BAD_REQUEST, response.text
    assert response.json()["code"] == CARD_STYLE_INVALID
    return response


async def test_a_style_survives_create_list_update_and_delete(
    app_client: httpx.AsyncClient,
) -> None:
    created = await make_style(
        app_client, module_type="metric-card", config_json=METRIC_LOOK
    )

    listed = await app_client.get(CARD_STYLES_URL)
    patched = await app_client.patch(
        f"{CARD_STYLES_URL}/{created['id']}", json={"name": "极简描边 2"}
    )
    removed = await app_client.delete(f"{CARD_STYLES_URL}/{created['id']}")
    gone = await app_client.get(f"{CARD_STYLES_URL}/{created['id']}")

    assert [item["id"] for item in page_of(listed)] == [created["id"]]
    assert data_of(patched)["name"] == "极简描边 2"
    assert removed.status_code == HTTP_NO_CONTENT
    assert gone.status_code == HTTP_NOT_FOUND
    assert gone.json()["code"] == CARD_STYLE_NOT_FOUND


async def test_the_list_carries_both_bags_of_values(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ 列表项带两袋取值：样式墙每一格都要照着它渲染一张预览。"""
    await make_style(
        app_client, module_type="metric-card", config_json=METRIC_LOOK
    )

    listed = await app_client.get(CARD_STYLES_URL)

    assert page_of(listed)[0]["chrome_json"] == CHROME
    assert page_of(listed)[0]["config_json"] == METRIC_LOOK


async def test_the_list_can_be_narrowed_to_one_module_type(
    app_client: httpx.AsyncClient,
) -> None:
    await make_style(app_client, name="通用外壳")
    await make_style(app_client, name="大字读数", module_type="metric-card")

    listed = await app_client.get(
        CARD_STYLES_URL, params={"module_type": "metric-card"}
    )

    assert [item["name"] for item in page_of(listed)] == ["大字读数"]


async def test_an_unregistered_module_type_is_refused_at_its_own_field(
    app_client: httpx.AsyncClient,
) -> None:
    response = await reject(app_client, module_type="not-a-module")

    assert issue_fields(response) == [("module_type", "module_type_unknown")]


async def test_a_generic_style_may_not_carry_a_config_bag(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ 内芯键是逐模块的：不绑模块却带内芯，套用时那半袋静默不生效。"""
    response = await reject(app_client, config_json={"layout": "grid"})

    assert issue_fields(response) == [
        ("config_json", "generic_style_carries_config")
    ]


async def test_a_chrome_key_outside_the_vocabulary_is_named_in_the_error(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ 报出**是哪个键**：外壳四十个键，只说「样式不合法」等于让人二分法找。"""
    response = await reject(
        app_client, chrome_json={"radius": 4, "borderStyleX": "glow"}
    )

    assert issue_fields(response) == [
        ("chrome_json.borderStyleX", "chrome_key_unknown")
    ]


async def test_a_content_key_may_not_be_stored_as_a_look_key(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ `title` 是内容键：存进样式，套用时会把别人配好的标题抹掉。"""
    response = await reject(
        app_client,
        module_type="metric-card",
        config_json={"layout": "grid", "title": "光伏总览"},
    )

    assert issue_fields(response) == [
        ("config_json.title", "config_key_not_a_look_key")
    ]


async def test_the_shell_segment_may_not_hide_inside_the_config_bag(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ `__cardStyle` 归 `chrome_json`：两袋各存一份外壳，套用时互相盖。

    内置预设正是把两者混在一袋里的，照抄一套预设去建样式必须先拆开。
    """
    response = await reject(
        app_client,
        module_type="metric-card",
        config_json={"__cardStyle": {"radius": 4}},
    )

    assert issue_fields(response) == [
        ("config_json.__cardStyle", "config_key_not_a_look_key")
    ]


async def test_an_unknown_module_type_does_not_also_indict_every_config_key(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ 类型没认出来时不查内芯：观感键取自那个模块，认不出就是空集。

    不挡这一下的话，一个写错的类型会连着报出一串「这不是观感键」，而真正
    要改的只有类型那一条。
    """
    response = await reject(
        app_client, module_type="not-a-module", config_json=METRIC_LOOK
    )

    assert issue_fields(response) == [("module_type", "module_type_unknown")]


async def test_every_bad_key_is_reported_in_one_pass(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ 一趟给全：改一条再发一次才看见下一条，六十个键要发很多趟。"""
    response = await reject(
        app_client,
        module_type="metric-card",
        chrome_json={"nope": 1},
        config_json={"title": "x", "items": []},
    )

    assert issue_fields(response) == [
        ("chrome_json.nope", "chrome_key_unknown"),
        ("config_json.items", "config_key_not_a_look_key"),
        ("config_json.title", "config_key_not_a_look_key"),
    ]


async def test_updating_one_bag_still_validates_the_other(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ 校验按改完之后的两袋走，否则只改内芯时外壳整段没人看。"""
    created = await make_style(app_client, module_type="metric-card")

    response = await app_client.patch(
        f"{CARD_STYLES_URL}/{created['id']}",
        json={"config_json": {"title": "光伏总览"}},
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert issue_fields(response) == [
        ("config_json.title", "config_key_not_a_look_key")
    ]


async def test_a_style_cannot_change_which_module_it_belongs_to(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ 换类型整段内芯当场作废，而库里那袋值不会跟着消失。

    入参基类是 `extra="forbid"`，故这个键根本进不来——拒在入参层而不是服务层，
    报的是「多带了一个字段」而不是一句业务错。
    """
    created = await make_style(app_client, module_type="metric-card")

    response = await app_client.patch(
        f"{CARD_STYLES_URL}/{created['id']}", json={"module_type": "info-card"}
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert [item["field"] for item in details_of(response)] == ["module_type"]


async def test_the_same_idempotency_key_creates_one_style(
    app_client: httpx.AsyncClient,
) -> None:
    body = {"name": "极简描边", "chrome_json": CHROME}
    headers = {"Idempotency-Key": "style-once"}

    first = await app_client.post(CARD_STYLES_URL, json=body, headers=headers)
    second = await app_client.post(CARD_STYLES_URL, json=body, headers=headers)
    listed = await app_client.get(CARD_STYLES_URL)

    assert data_of(first)["id"] == data_of(second)["id"]
    assert len(page_of(listed)) == 1


async def test_two_styles_may_share_a_name(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ 刻意不建 `(module_type, name)` 唯一键。

    撞名时「另存为」要的是再存一条，不是一句 409。
    """
    first = await make_style(app_client, module_type="metric-card")
    second = await make_style(app_client, module_type="metric-card")

    assert first["id"] != second["id"]


async def test_a_missing_style_is_a_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{CARD_STYLES_URL}/{MISSING_ID}")

    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == CARD_STYLE_NOT_FOUND
