"""模型目录：按用途解端点、解不出就给 None、线形不成形当场拒。

守的是三件出了事才看得见的事：分配指向停用的那一路要退回 None（否则每次
对话撞 401）、嵌入用途不许解成对话模型（拿对话模型名打 embeddings 端点必败）、
以及内容摘要**不含密钥**（摘要会进日志与响应）。
"""

import pytest
from pydantic import SecretStr

from llmcore import (
    EMPTY_CATALOG,
    PROVIDER_KIND_OPENAI_COMPAT,
    Assignment,
    CatalogMalformed,
    ModelCatalog,
    ModelSpec,
    ProviderSpec,
    catalog_version,
)

CHAT = ModelSpec(name="chat-1", kind="chat", has_vision=True)
EMBED = ModelSpec(name="embed-1", kind="embedding", dimensions=1024)
RERANK = ModelSpec(name="rerank-1", kind="rerank")


def _provider(
    *,
    is_enabled: bool = True,
    models: tuple[ModelSpec, ...] = (CHAT, EMBED),
    kind: str = PROVIDER_KIND_OPENAI_COMPAT,
) -> ProviderSpec:
    return ProviderSpec(
        id="p1",
        name="百炼",
        kind=kind,
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
        kind=one.kind,
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


def test_a_non_endpoint_provider_resolves_to_no_endpoint() -> None:
    """⚠ 要先登录的那些形态没有端点与密钥：放行等于拿空地址打出去，
    而报出来的是一条连不上的网络错，与「这一路不是这么接的」对不上。"""
    catalog = _catalog(
        _provider(kind="codex_oauth"), Assignment("a.chat", "p1", "chat-1")
    )
    assert catalog.chat_endpoint("a.chat", timeout_s=30.0) is None
    assert catalog.resolve("a.chat") is not None


def test_a_non_endpoint_provider_resolves_to_no_embedding_endpoint() -> None:
    catalog = _catalog(
        _provider(kind="codex_oauth"), Assignment("a.embed", "p1", "embed-1")
    )
    assert catalog.embedding_endpoint("a.embed", timeout_s=10.0) is None


def test_an_endpoint_can_be_built_on_a_named_model() -> None:
    """会话里选了另一路时按那一路上的模型现打一个端点。"""
    provider = _provider()
    endpoint = ModelCatalog(providers=(provider,), assignments=()).endpoint_on(
        provider, CHAT, timeout_s=12.0
    )
    assert endpoint is not None
    assert endpoint.model == "chat-1"
    assert endpoint.timeout_s == 12.0


def test_an_embedding_model_never_becomes_a_chat_endpoint() -> None:
    provider = _provider()
    assert (
        ModelCatalog(providers=(provider,), assignments=()).endpoint_on(
            provider, EMBED, timeout_s=12.0
        )
        is None
    )


def test_disabled_providers_stay_out_of_the_enabled_list() -> None:
    """⚠ 停用的那一路仍要按 id 取得到：「配了但停着」与「没这一路」是两回事。"""
    catalog = _catalog(_provider(is_enabled=False))
    assert catalog.enabled_providers() == ()
    assert catalog.provider("p1") is not None
    assert catalog.provider("nope") is None


def test_models_are_listed_per_kind_in_registration_order() -> None:
    assert _provider().models_of("chat") == (CHAT,)
    assert _provider().models_of("embedding") == (EMBED,)


def test_an_assignment_is_readable_even_when_it_points_at_a_disabled_one() -> (
    None
):
    catalog = _catalog(
        _provider(is_enabled=False), Assignment("a.chat", "p1", "chat-1")
    )
    assert catalog.resolve("a.chat") is None
    assigned = catalog.assigned("a.chat")
    assert assigned is not None
    assert assigned.provider_id == "p1"


def test_the_wire_defaults_to_the_openai_compatible_kind() -> None:
    """⚠ 平台比消费方先升级不是必然的：没有这一格的旧目录里每一路
    本来就都是这一形态。"""
    catalog = ModelCatalog.from_wire(
        {
            "version": "v1",
            "providers": [
                {
                    "id": "p1",
                    "name": "百炼",
                    "base_url": "https://endpoint/v1",
                    "api_key": "sk-1",
                    "models": [{"name": "chat-1", "kind": "chat"}],
                }
            ],
            "assignments": [],
        }
    )
    assert catalog.providers[0].kind == PROVIDER_KIND_OPENAI_COMPAT
    assert catalog.providers[0].is_endpoint_based


def test_the_wire_carries_the_kind_and_its_options() -> None:
    catalog = ModelCatalog.from_wire(
        {
            "version": "v1",
            "providers": [
                {
                    "id": "p2",
                    "name": "Codex",
                    "kind": "codex_oauth",
                    "options": {"default_effort": "high"},
                    "models": [{"name": "gpt-5-codex", "kind": "chat"}],
                }
            ],
            "assignments": [],
        }
    )
    provider = catalog.providers[0]
    assert provider.kind == "codex_oauth"
    assert provider.options == {"default_effort": "high"}
    assert not provider.is_endpoint_based
    assert provider.base_url == ""


def test_the_version_digest_changes_with_the_kind() -> None:
    """⚠ 形态变了必须算成另一份目录：不然消费方会拿旧适配器接新形态。"""
    plain = _provider()
    other = _provider(kind="codex_oauth")
    assert catalog_version((plain,), ()) != catalog_version((other,), ())


def _rerank_provider(
    options: dict[str, object] | None = None,
) -> ProviderSpec:
    return ProviderSpec(
        id="p1",
        name="重排那一路",
        kind=PROVIDER_KIND_OPENAI_COMPAT,
        base_url="https://endpoint/v1",
        api_key=SecretStr("sk-secret"),
        is_enabled=True,
        models=(RERANK,),
        options=options,
    )


def test_an_assigned_rerank_purpose_carries_the_configured_dialect() -> None:
    catalog = _catalog(
        _rerank_provider({"rerank_dialect": "dashscope"}),
        Assignment("a.rerank", "p1", "rerank-1"),
    )
    endpoint = catalog.rerank_endpoint("a.rerank", timeout_s=8.0)
    assert endpoint is not None
    assert endpoint.model == "rerank-1"
    assert endpoint.dialect == "dashscope"
    assert endpoint.timeout_s == 8.0


def test_an_unconfigured_dialect_is_an_empty_string_not_a_guess() -> None:
    """⚠ 这一层不挑方言：挑哪一路是方言注册表的事，而它在调用侧。"""
    catalog = _catalog(
        _rerank_provider(), Assignment("a.rerank", "p1", "rerank-1")
    )
    endpoint = catalog.rerank_endpoint("a.rerank", timeout_s=8.0)
    assert endpoint is not None
    assert endpoint.dialect == ""


def test_a_dialect_that_is_not_a_string_is_read_as_unconfigured() -> None:
    """⚠ `options` 是一段透传 JSON，塞个数字进来也存得下。"""
    provider = _rerank_provider({"rerank_dialect": 7})
    assert provider.rerank_dialect == ""


def test_a_rerank_purpose_never_resolves_to_a_chat_model() -> None:
    """⚠ 拿对话模型名去打重排端点是一条必然失败的调用。"""
    catalog = _catalog(_provider(), Assignment("a.rerank", "p1", "chat-1"))
    assert catalog.rerank_endpoint("a.rerank", timeout_s=1.0) is None


def test_a_login_based_lane_has_no_rerank_endpoint() -> None:
    provider = ProviderSpec(
        id="p1",
        name="订阅那一路",
        kind="codex_oauth",
        base_url="",
        api_key=SecretStr(""),
        is_enabled=True,
        models=(RERANK,),
    )
    catalog = _catalog(provider, Assignment("a.rerank", "p1", "rerank-1"))
    assert catalog.rerank_endpoint("a.rerank", timeout_s=1.0) is None


def test_rerank_models_are_listed_under_their_own_kind() -> None:
    provider = _provider(models=(CHAT, EMBED, RERANK))
    assert provider.models_of("rerank") == (RERANK,)
