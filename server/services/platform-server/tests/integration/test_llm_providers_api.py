"""模型供应商面打真库：建、列、改、删、分配用途、内部目录。

守的是这一族最要紧的四件事：密钥**只以密文落库**且出参一个字都不回；
还被用途指着的供应商删不掉（放行的话消费方静默退回环境变量那一档）；
分配时用途、模型与种类要对齐（嵌入用途不许指对话模型）；内部目录只认服务级
密钥、解开的密钥只在那一条端点上出现。
"""

from dataclasses import replace
from typing import Any

import httpx
import pytest
from conftest import AppContext, SignHeaders
from pydantic import SecretStr
from sqlalchemy import select

from lib.crypto import SecretCipher
from platform_server.apps.llm_providers.catalog import LLM_VIEW
from platform_server.apps.llm_providers.models import LlmProvider

pytestmark = pytest.mark.requires_postgres

PROVIDERS = "/api/v1/platform/llm-providers"
KINDS = "/api/v1/platform/llm-provider-kinds"
PURPOSES = "/api/v1/platform/llm-purposes"
CATALOG = "/internal/v1/platform/llm-catalog"
SECRET = "llm-provider-secret-0123456789abcdef"
HTTP_CREATED = 201
HTTP_NO_CONTENT = 204
HTTP_BAD_REQUEST = 400
HTTP_UNAUTHORIZED = 401
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409
HTTP_UNAVAILABLE = 503


def data_of(response: httpx.Response) -> Any:
    """取信封里的 data。"""
    return response.json()["data"]


def _body(name: str = "百炼", **overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "name": name,
        "base_url": "https://endpoint/compatible-mode/v1/",
        "api_key": "sk-very-secret-1234",
        "models": [
            {"name": "qwen-plus", "kind": "chat", "has_vision": True},
            {
                "name": "text-embedding-v3",
                "kind": "embedding",
                "dimensions": 1024,
            },
        ],
    }
    base.update(overrides)
    return base


@pytest.fixture
def llm_context(app_context: AppContext) -> AppContext:
    """把加解密器装进容器：根 conftest 那份配置没配加密密钥。

    Args: app_context。
    """
    application = (
        app_context.client._transport.app
    )  # pyright: ignore[reportPrivateUsage, reportAttributeAccessIssue]  # 理由：用例要往容器里换件
    container = application.state.container
    application.state.container = replace(
        container,
        llm_cipher=SecretCipher(SECRET, label="test"),
        settings=container.settings.model_copy(
            update={"llm_provider_secret": SecretStr(SECRET)}
        ),
    )
    return app_context


async def _create(client: httpx.AsyncClient, **overrides: object) -> Any:
    response = await client.post(PROVIDERS, json=_body(**overrides))
    assert response.status_code == HTTP_CREATED, response.text
    return data_of(response)


async def test_the_key_is_stored_encrypted_and_never_returned(
    llm_context: AppContext,
) -> None:
    created = await _create(llm_context.client)
    assert created["api_key_hint"] == "…1234"
    assert "api_key" not in created
    # 端点尾巴的斜杠要吃掉，否则拼出来的路径里是两个斜杠
    assert created["base_url"] == "https://endpoint/compatible-mode/v1"
    row = (await llm_context.session.execute(select(LlmProvider))).scalar_one()
    assert "sk-very-secret" not in row.api_key_enc
    listed = data_of(await llm_context.client.get(PROVIDERS))
    assert listed["total"] == 1
    assert "api_key" not in listed["items"][0]


async def test_creating_twice_with_the_same_name_conflicts(
    llm_context: AppContext,
) -> None:
    await _create(llm_context.client)
    response = await llm_context.client.post(PROVIDERS, json=_body())
    assert response.status_code == HTTP_CONFLICT


async def test_the_idempotency_key_makes_the_create_replayable(
    llm_context: AppContext,
) -> None:
    headers = {"Idempotency-Key": "k-1"}
    first = await llm_context.client.post(
        PROVIDERS, json=_body(), headers=headers
    )
    again = await llm_context.client.post(
        PROVIDERS, json=_body(), headers=headers
    )
    assert first.status_code == HTTP_CREATED
    assert again.status_code == HTTP_CREATED
    assert data_of(first)["id"] == data_of(again)["id"]


async def test_updating_without_a_key_keeps_the_old_one(
    llm_context: AppContext,
) -> None:
    created = await _create(llm_context.client)
    response = await llm_context.client.patch(
        f"{PROVIDERS}/{created['id']}",
        json={"name": "改名", "extra_body": None},
    )
    assert response.status_code == httpx.codes.OK
    assert data_of(response)["name"] == "改名"
    assert data_of(response)["api_key_hint"] == "…1234"


async def test_assigning_a_purpose_then_the_provider_cannot_be_deleted(
    llm_context: AppContext,
) -> None:
    created = await _create(llm_context.client)
    assigned = await llm_context.client.put(
        f"{PURPOSES}/assistant.chat",
        json={"provider_id": created["id"], "model_name": "qwen-plus"},
    )
    assert assigned.status_code == httpx.codes.OK, assigned.text
    assert data_of(assigned)["provider_name"] == "百炼"
    detail = data_of(
        await llm_context.client.get(f"{PROVIDERS}/{created['id']}")
    )
    assert detail["assigned_purposes"] == ["assistant.chat"]

    blocked = await llm_context.client.delete(f"{PROVIDERS}/{created['id']}")
    assert blocked.status_code == HTTP_CONFLICT

    cleared = await llm_context.client.delete(f"{PURPOSES}/assistant.chat")
    assert cleared.status_code == HTTP_NO_CONTENT
    gone = await llm_context.client.delete(f"{PROVIDERS}/{created['id']}")
    assert gone.status_code == HTTP_NO_CONTENT


@pytest.mark.parametrize(
    ("purpose", "model", "expected"),
    [
        ("assistant.embedding", "qwen-plus", HTTP_BAD_REQUEST),
        ("assistant.chat", "text-embedding-v3", HTTP_BAD_REQUEST),
        ("assistant.chat", "no-such-model", HTTP_BAD_REQUEST),
        ("assistant.nonsense", "qwen-plus", HTTP_NOT_FOUND),
    ],
    ids=[
        "chat-for-embedding",
        "embedding-for-chat",
        "unknown-model",
        "unknown",
    ],
)
async def test_a_mismatched_assignment_is_rejected(
    llm_context: AppContext, purpose: str, model: str, expected: int
) -> None:
    created = await _create(llm_context.client)
    response = await llm_context.client.put(
        f"{PURPOSES}/{purpose}",
        json={"provider_id": created["id"], "model_name": model},
    )
    assert response.status_code == expected


async def test_a_vision_purpose_needs_a_vision_model(
    llm_context: AppContext,
) -> None:
    created = await _create(
        llm_context.client,
        models=[{"name": "blind", "kind": "chat", "has_vision": False}],
    )
    response = await llm_context.client.put(
        f"{PURPOSES}/assistant.vision",
        json={"provider_id": created["id"], "model_name": "blind"},
    )
    assert response.status_code == HTTP_BAD_REQUEST


async def test_the_purpose_list_covers_every_purpose_once(
    llm_context: AppContext,
) -> None:
    listed = data_of(await llm_context.client.get(PURPOSES))
    codes = [one["purpose"] for one in listed]
    assert len(codes) == len(set(codes))
    assert "assistant.chat" in codes
    assert "knowledge.embedding" in codes
    assert all(one["provider_id"] is None for one in listed)


async def test_a_rerank_purpose_reaches_the_catalog_with_its_dialect(
    llm_context: AppContext, settings: Any
) -> None:
    """⚠ 方言随**供应商**下发而不是随模型：调用侧按它挑线形，缺了这一格
    它只能按默认那一套打，而那多半是一条 404。"""
    created = await _create(
        llm_context.client,
        name="重排那一路",
        models=[{"name": "gte-rerank-v2", "kind": "rerank"}],
        options={"rerank_dialect": "dashscope"},
    )
    assigned = await llm_context.client.put(
        f"{PURPOSES}/knowledge.rerank",
        json={"provider_id": created["id"], "model_name": "gte-rerank-v2"},
    )
    assert assigned.status_code == httpx.codes.OK
    service_key = settings.edge_service_key.get_secret_value()
    catalog = data_of(
        await llm_context.client.get(
            CATALOG, headers={"X-Service-Key": service_key}
        )
    )
    provider = catalog["providers"][0]
    assert provider["options"] == {"rerank_dialect": "dashscope"}
    assert provider["models"][0]["kind"] == "rerank"
    assert provider["models"][0]["dimensions"] is None
    assert catalog["assignments"][0]["purpose"] == "knowledge.rerank"


async def test_a_rerank_purpose_refuses_a_chat_model(
    llm_context: AppContext,
) -> None:
    """⚠ 拿对话模型名去打重排端点是一条必然失败的调用。"""
    created = await _create(llm_context.client)
    response = await llm_context.client.put(
        f"{PURPOSES}/knowledge.rerank",
        json={"provider_id": created["id"], "model_name": "qwen-plus"},
    )
    assert response.status_code == HTTP_BAD_REQUEST


async def test_the_internal_catalog_carries_the_plain_key(
    llm_context: AppContext, settings: Any
) -> None:
    created = await _create(llm_context.client)
    await llm_context.client.put(
        f"{PURPOSES}/knowledge.embedding",
        json={"provider_id": created["id"], "model_name": "text-embedding-v3"},
    )
    service_key = settings.edge_service_key.get_secret_value()
    response = await llm_context.client.get(
        CATALOG, headers={"X-Service-Key": service_key}
    )
    assert response.status_code == httpx.codes.OK
    catalog = data_of(response)
    assert catalog["version"]
    assert catalog["providers"][0]["api_key"] == "sk-very-secret-1234"
    assert catalog["assignments"] == [
        {
            "purpose": "knowledge.embedding",
            "provider_id": created["id"],
            "model_name": "text-embedding-v3",
        }
    ]


async def test_the_internal_catalog_refuses_without_the_service_key(
    llm_context: AppContext,
) -> None:
    response = await llm_context.client.get(CATALOG)
    assert response.status_code == HTTP_UNAUTHORIZED


async def test_a_viewer_can_list_but_not_write(
    llm_context: AppContext, sign: SignHeaders
) -> None:
    viewer = sign((LLM_VIEW,))
    listed = await llm_context.client.get(PROVIDERS, headers=viewer)
    assert listed.status_code == httpx.codes.OK
    denied = await llm_context.client.post(
        PROVIDERS, json=_body(), headers=viewer
    )
    assert denied.status_code == HTTP_FORBIDDEN


async def test_without_the_secret_the_face_is_absent_not_broken(
    app_context: AppContext, settings: Any
) -> None:
    """没配加密密钥：对外端点如实 503，内部目录回空——不是 500。"""
    response = await app_context.client.post(PROVIDERS, json=_body())
    assert response.status_code == HTTP_UNAVAILABLE
    listed = await app_context.client.get(PROVIDERS)
    assert listed.status_code == httpx.codes.OK
    catalog = await app_context.client.get(
        CATALOG,
        headers={"X-Service-Key": settings.edge_service_key.get_secret_value()},
    )
    assert catalog.status_code == httpx.codes.OK
    assert data_of(catalog)["providers"] == []


def _codex_body(**overrides: object) -> dict[str, object]:
    """一路靠登录的供应商：没有端点与密钥。"""
    base: dict[str, object] = {
        "name": "Codex",
        "kind": "codex_oauth",
        "models": [{"name": "gpt-5-codex", "kind": "chat"}],
        "options": {"default_effort": "high"},
    }
    base.update(overrides)
    return base


async def test_a_login_based_provider_is_created_without_an_endpoint(
    llm_context: AppContext,
) -> None:
    response = await llm_context.client.post(PROVIDERS, json=_codex_body())
    assert response.status_code == HTTP_CREATED, response.text
    created = data_of(response)
    assert created["kind"] == "codex_oauth"
    assert created["base_url"] == ""
    assert created["api_key_hint"] == ""
    assert created["options"] == {"default_effort": "high"}


async def test_a_login_based_provider_cannot_be_probed(
    llm_context: AppContext,
) -> None:
    """⚠ 没有端点就没得探：放行的话它会拿空地址打出去，
    而报出来的是一条连不上的网络错。"""
    created = data_of(
        await llm_context.client.post(PROVIDERS, json=_codex_body())
    )
    response = await llm_context.client.post(
        f"{PROVIDERS}/{created['id']}:probe"
    )
    assert response.status_code == HTTP_BAD_REQUEST


async def test_a_login_based_provider_serves_the_assistant(
    llm_context: AppContext,
) -> None:
    created = data_of(
        await llm_context.client.post(PROVIDERS, json=_codex_body())
    )
    response = await llm_context.client.put(
        f"{PURPOSES}/assistant.chat",
        json={"provider_id": created["id"], "model_name": "gpt-5-codex"},
    )
    assert response.status_code == 200, response.text


async def test_a_login_based_provider_is_refused_by_the_other_consumer(
    llm_context: AppContext,
) -> None:
    """⚠ 知识库没接这一路的适配器：放行的话分配写得进去、那一侧却永远
    沿用环境变量那一档，而界面上显示配好了。"""
    created = data_of(
        await llm_context.client.post(PROVIDERS, json=_codex_body())
    )
    response = await llm_context.client.put(
        f"{PURPOSES}/knowledge.chat",
        json={"provider_id": created["id"], "model_name": "gpt-5-codex"},
    )
    assert response.status_code == HTTP_BAD_REQUEST


async def test_an_update_that_breaks_the_shape_is_rejected(
    llm_context: AppContext,
) -> None:
    """⚠ 按改完的样子判：只传 models 的那一次也能让一路 Codex 上多出一个
    没有任何一侧读得到的嵌入模型。"""
    created = data_of(
        await llm_context.client.post(PROVIDERS, json=_codex_body())
    )
    response = await llm_context.client.patch(
        f"{PROVIDERS}/{created['id']}",
        json={"models": [{"name": "e", "kind": "embedding", "dimensions": 8}]},
    )
    assert response.status_code == HTTP_BAD_REQUEST


async def test_the_internal_catalog_carries_the_kind_and_options(
    llm_context: AppContext, settings: Any
) -> None:
    await llm_context.client.post(PROVIDERS, json=_codex_body())
    body = data_of(
        await llm_context.client.get(
            CATALOG,
            headers={
                "X-Service-Key": settings.edge_service_key.get_secret_value()
            },
        )
    )
    provider = body["providers"][0]
    assert provider["kind"] == "codex_oauth"
    assert provider["api_key"] == ""
    assert provider["options"] == {"default_effort": "high"}


async def test_the_kind_catalog_describes_what_to_configure(
    llm_context: AppContext,
) -> None:
    """⚠ 前端按它渲染表单：这一份与后端校验漂开的表现是「表单里填了、
    保存时 422」，而那句话指不回是哪一格多余。"""
    listed = data_of(await llm_context.client.get(KINDS))
    by_code = {one["code"]: one for one in listed}
    assert by_code["openai_compat"]["is_endpoint_required"] is True
    assert by_code["openai_compat"]["presets"][0]["code"] == "dashscope"
    codex = by_code["codex_oauth"]
    assert codex["is_endpoint_required"] is False
    assert codex["is_login_required"] is True
    assert codex["consumers"] == ["assistant"]
    assert codex["efforts"] == ["low", "medium", "high", "xhigh"]


async def test_the_kind_catalog_lists_the_rerank_dialects(
    llm_context: AppContext,
) -> None:
    """⚠ 方言清单由后端下发而不是前端写死：漂开的表现是界面上选得中一个
    调用侧根本没装的线形，而那要到第一次检索才看得见。"""
    listed = data_of(await llm_context.client.get(KINDS))
    by_code = {one["code"]: one for one in listed}
    dialects = by_code["openai_compat"]["rerank_dialects"]
    assert [one["code"] for one in dialects] == ["jina", "dashscope"]
    assert all(one["label"] for one in dialects)
    # ⚠ 订阅那一路打不出重排端点，故它一套线形都不该摆
    assert by_code["codex_oauth"]["rerank_dialects"] == []
    assert "rerank" in by_code["openai_compat"]["model_kinds"]
    assert "rerank" not in by_code["codex_oauth"]["model_kinds"]
