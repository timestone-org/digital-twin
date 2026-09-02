"""模型目录：按用途解端点、解不出就给 None、线形不成形当场拒。

守的是三件出了事才看得见的事：分配指向停用的那一路要退回 None（否则每次
对话撞 401）、嵌入用途不许解成对话模型（拿对话模型名打 embeddings 端点必败）、
以及内容摘要**不含密钥**（摘要会进日志与响应）。
"""

import pytest
from pydantic import SecretStr

from llmcore import (
    EMPTY_CATALOG,
    Assignment,
    CatalogMalformed,
    ModelCatalog,
    ModelSpec,
    ProviderSpec,
    catalog_version,
)

CHAT = ModelSpec(name="chat-1", kind="chat", has_vision=True)
EMBED = ModelSpec(name="embed-1", kind="embedding", dimensions=1024)


def _provider(
    *, is_enabled: bool = True, models: tuple[ModelSpec, ...] = (CHAT, EMBED)
) -> ProviderSpec:
    return ProviderSpec(
        id="p1",
        name="百炼",
        base_url="https://endpoint/v1",
        api_key=SecretStr("sk-secret"),
        is_enabled=is_enabled,
        models=models,
        extra_body={"enable_thinking": True},
    )


def _catalog(provider: ProviderSpec, *assignments: Assignment) -> ModelCatalog:
    return ModelCatalog(providers=(provider,), assignments=assignments)


def test_an_assigned_chat_purpose_resolves_to_its_endpoint() -> None:
    catalog = _catalog(_provider(), Assignment("a.chat", "p1", "chat-1"))
    endpoint = catalog.chat_endpoint("a.chat", timeout_s=30.0)
    assert endpoint is not None
    assert endpoint.base_url == "https://endpoint/v1"
    assert endpoint.model == "chat-1"
    assert endpoint.timeout_s == 30.0
    assert endpoint.extra_body == {"enable_thinking": True}
    assert endpoint.api_key.get_secret_value() == "sk-secret"


def test_an_assigned_embedding_purpose_carries_its_dimensions() -> None:
    catalog = _catalog(_provider(), Assignment("a.embed", "p1", "embed-1"))
    endpoint = catalog.embedding_endpoint("a.embed", timeout_s=10.0)
    assert endpoint is not None
    assert endpoint.model == "embed-1"
    assert endpoint.dimensions == 1024


def test_an_unassigned_purpose_resolves_to_nothing() -> None:
    catalog = _catalog(_provider())
    assert catalog.resolve("a.chat") is None
    assert catalog.chat_endpoint("a.chat", timeout_s=1.0) is None


def test_a_disabled_provider_is_as_good_as_unassigned() -> None:
    # 停用那一路之后仍然解出来的话，每一次对话都会去打一个不该打的端点
    catalog = _catalog(
        _provider(is_enabled=False), Assignment("a.chat", "p1", "chat-1")
    )
    assert catalog.resolve("a.chat") is None


def test_a_chat_model_never_serves_an_embedding_purpose() -> None:
    catalog = _catalog(_provider(), Assignment("a.embed", "p1", "chat-1"))
    assert catalog.embedding_endpoint("a.embed", timeout_s=1.0) is None
    assert catalog.chat_endpoint("a.embed", timeout_s=1.0) is not None


def test_an_embedding_model_without_dimensions_is_not_usable() -> None:
    bare = ModelSpec(name="embed-x", kind="embedding")
    catalog = _catalog(
        _provider(models=(bare,)), Assignment("a.embed", "p1", "embed-x")
    )
    assert catalog.embedding_endpoint("a.embed", timeout_s=1.0) is None


def test_the_wire_shape_round_trips() -> None:
    body = {
        "version": "v1",
        "providers": [
            {
                "id": "p1",
                "name": "百炼",
                "base_url": "https://endpoint/v1",
                "api_key": "sk-secret",
                "is_enabled": True,
                "extra_body": None,
                "models": [
                    {"name": "chat-1", "kind": "chat", "has_vision": False},
                    {
                        "name": "embed-1",
                        "kind": "embedding",
                        "dimensions": 1536,
                    },
                ],
            }
        ],
        "assignments": [
            {"purpose": "a.chat", "provider_id": "p1", "model_name": "chat-1"}
        ],
    }
    catalog = ModelCatalog.from_wire(body)
    assert catalog.version == "v1"
    assert catalog.resolve("a.chat") is not None
    assert catalog.providers[0].model_named("embed-1") == ModelSpec(
        name="embed-1", kind="embedding", dimensions=1536
    )


@pytest.mark.parametrize(
    "body",
    [
        None,
        "not a catalog",
        {"providers": [{"id": "", "name": "x"}]},
        {"assignments": [{"purpose": "a"}]},
    ],
    ids=["none", "text", "provider-without-id", "assignment-half"],
)
def test_a_malformed_wire_is_rejected(body: object) -> None:
    with pytest.raises(CatalogMalformed):
        ModelCatalog.from_wire(body)


def test_the_empty_catalog_is_empty() -> None:
    assert EMPTY_CATALOG.is_empty
    assert EMPTY_CATALOG.resolve("anything") is None


def test_the_version_digest_ignores_the_secret() -> None:
    """⚠ 摘要会进日志与响应：把密钥算进去等于把它的哈希摊出去。"""
    one = _provider()
    other = ProviderSpec(
        id=one.id,
        name=one.name,
        base_url=one.base_url,
        api_key=SecretStr("another-secret"),
        is_enabled=one.is_enabled,
        models=one.models,
        extra_body=one.extra_body,
    )
    assert catalog_version((one,), ()) == catalog_version((other,), ())


def test_the_version_digest_changes_with_the_assignment() -> None:
    provider = _provider()
    before = catalog_version((provider,), ())
    after = catalog_version(
        (provider,), (Assignment("a.chat", "p1", "chat-1"),)
    )
    assert before != after
