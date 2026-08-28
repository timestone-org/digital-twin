"""能力面：前端靠它决定摆不摆助手入口。

⚠ 这条端点在模型不可用时必须**照常成功**并如实说「模型没开」——回 5xx 的话，
前端会把「本部署没接模型」读成「后端坏了」，于是本该干净缺席的场合变成一条
红色告警。
"""

from collections.abc import Callable

import httpx

# 身份头工厂的形状。⚠ 不从 conftest import：workspace 里每个服务都有一个顶层
# `tests` 包，那条 import 会解析到别的服务的 conftest
HeaderFactory = Callable[..., dict[str, str]]

CAPABILITIES_URL = "/api/v1/assistant/capabilities"


def _data(response: httpx.Response) -> dict[str, object]:
    body = response.json()
    assert isinstance(body, dict)
    payload = body["data"]
    assert isinstance(payload, dict)
    return payload


async def test_capabilities_answers_even_when_the_model_is_off(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(CAPABILITIES_URL)
    assert response.status_code == 200
    assert _data(response)["is_model_enabled"] is False


async def test_capabilities_lists_the_installed_skills(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(CAPABILITIES_URL)
    skills = _data(response)["skills"]
    assert isinstance(skills, list)
    assert len(skills) > 0


async def test_capabilities_carries_a_trace_id(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(CAPABILITIES_URL)
    body = response.json()
    assert body["trace_id"]


async def test_capabilities_rejects_an_unsigned_caller(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        CAPABILITIES_URL, headers={"X-Auth-Sig": ""}
    )
    assert response.status_code == 401


async def test_capabilities_rejects_a_caller_without_the_code(
    app_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    response = await app_client.get(
        CAPABILITIES_URL, headers=sign(["dashboard:view"])
    )
    assert response.status_code == 403


async def test_capabilities_lists_no_model_route_when_none_is_configured(
    app_client: httpx.AsyncClient,
) -> None:
    # 摆出一个点了报错的选项，比干净地不摆更难查
    body = _data(await app_client.get(CAPABILITIES_URL))
    assert body["models"] == []
    assert body["is_model_enabled"] is False


async def test_capabilities_hands_out_a_default_effort(
    app_client: httpx.AsyncClient,
) -> None:
    """前端要把它填进 choice.effort；缺了这一格订阅那一路按端点缺省档跑。"""
    body = _data(await app_client.get(CAPABILITIES_URL))
    assert body["default_effort"] == "medium"
