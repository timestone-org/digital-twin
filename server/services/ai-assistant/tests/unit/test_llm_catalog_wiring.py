"""模型目录接进助手（ADR-0039）：目录里分配了就走目录，没分配退环境变量。

守的是三件只在现场才看得见的事：界面上分配了新模型、这一侧要真的换端点
（而不是继续打环境变量那一档）；目录还是空的时候环境变量那一档照常能用；
以及每个异步入口先让目录刷新一次——不刷新的话改了分配永远看不见。
"""

from pydantic import SecretStr

from ai_assistant.apps.chat.services import model_profiles
from ai_assistant.llm import (
    DEFAULT_PROFILE,
    AdapterDeps,
    ModelChoice,
)
from ai_assistant.llm.adapters import (
    build_openai_embedding,
    resolve_chat_endpoint,
    resolve_embedding_endpoint,
)
from ai_assistant.llm.registry import ModelRegistry
from ai_assistant.settings import Settings
from llmcore import (
    EMPTY_CATALOG,
    Assignment,
    ModelCatalog,
    ModelSpec,
    ProviderSpec,
)

SECRET = SecretStr("s" * 32)


class _Catalog:
    """目录源的替身：手里一份快照，记下被刷新了几次。"""

    def __init__(self, catalog: ModelCatalog = EMPTY_CATALOG) -> None:
        self.catalog = catalog
        self.refreshed = 0

    def snapshot(self) -> ModelCatalog:
        return self.catalog

    async def refresh(self, *, is_forced: bool = False) -> ModelCatalog:
        del is_forced
        self.refreshed += 1
        return self.catalog


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "postgres_host": "x",
        "postgres_user": "x",
        "postgres_password": SecretStr("x"),
        "postgres_db": "x",
        "redis_host": "x",
        "edge_signing_secret": SECRET,
        "edge_service_key": SECRET,
    }
    base.update(overrides)
    return Settings(
        **base
    )  # pyright: ignore[reportArgumentType]  # 理由：用例造件按名传参


def _assigned() -> ModelCatalog:
    provider = ProviderSpec(
        id="p1",
        name="百炼",
        base_url="https://catalog/v1",
        api_key=SecretStr("sk-catalog"),
        is_enabled=True,
        models=(
            ModelSpec(name="catalog-chat", kind="chat", has_vision=True),
            ModelSpec(name="catalog-embed", kind="embedding", dimensions=8),
        ),
        extra_body={"enable_thinking": False},
    )
    return ModelCatalog(
        providers=(provider,),
        assignments=(
            Assignment("assistant.chat", "p1", "catalog-chat"),
            Assignment("assistant.vision", "p1", "catalog-chat"),
            Assignment("assistant.embedding", "p1", "catalog-embed"),
        ),
        version="v1",
    )


def test_an_assigned_purpose_beats_the_environment() -> None:
    deps = AdapterDeps(
        settings=_settings(
            model_enabled=True,
            model_api_key=SecretStr("sk-env"),
            model_chat="env-chat",
        ),
        catalog=_Catalog(_assigned()),
    )
    endpoint = resolve_chat_endpoint(deps, "chat")
    assert endpoint is not None
    assert endpoint.base_url == "https://catalog/v1"
    assert endpoint.model == "catalog-chat"
    assert endpoint.api_key.get_secret_value() == "sk-catalog"
    assert endpoint.extra_body == {"enable_thinking": False}


def test_an_unassigned_purpose_falls_back_to_the_environment() -> None:
    """折叠摘要那一档目录里没分配：仍然走环境变量的对话档，不能变成没接。"""
    deps = AdapterDeps(
        settings=_settings(
            model_enabled=True,
            model_api_key=SecretStr("sk-env"),
            model_chat="env-chat",
        ),
        catalog=_Catalog(_assigned()),
    )
    endpoint = resolve_chat_endpoint(deps, "summary")
    assert endpoint is not None
    assert endpoint.model == "env-chat"
    assert endpoint.api_key.get_secret_value() == "sk-env"


def test_an_empty_catalog_leaves_the_environment_route_alone() -> None:
    deps = AdapterDeps(
        settings=_settings(model_enabled=True, model_api_key=SecretStr("k")),
        catalog=_Catalog(),
    )
    registry = ModelRegistry(deps)
    listed = registry.profiles()
    assert [one.id for one in listed] == [DEFAULT_PROFILE]
    assert listed[0].models == ("qwen3.8-max",)


def test_the_profile_reports_the_catalog_model_and_vision() -> None:
    registry = ModelRegistry(
        AdapterDeps(settings=_settings(), catalog=_Catalog(_assigned()))
    )
    profile = registry.profiles()[0]
    assert profile.models == ("catalog-chat",)
    assert profile.has_vision is True
    assert profile.is_ready is True


def test_no_environment_and_an_empty_catalog_means_nothing_ready() -> None:
    registry = ModelRegistry(
        AdapterDeps(settings=_settings(), catalog=_Catalog())
    )
    assert registry.profiles() == ()
    # 但适配器装着：目录随时可能给它端点
    assert len(registry.adapters()) == 1


async def test_resolving_refreshes_the_catalog_first() -> None:
    catalog = _Catalog(_assigned())
    registry = ModelRegistry(AdapterDeps(settings=_settings(), catalog=catalog))
    built = await registry.resolve(ModelChoice())
    assert catalog.refreshed == 1
    assert built.model_name == "catalog-chat"


async def test_listing_profiles_refreshes_the_catalog_first() -> None:
    catalog = _Catalog(_assigned())
    registry = ModelRegistry(AdapterDeps(settings=_settings(), catalog=catalog))
    listed = await model_profiles.profiles_of(registry, None)
    assert catalog.refreshed == 1
    assert listed[0].models == ["catalog-chat"]


def test_the_embedding_route_follows_the_catalog_too() -> None:
    deps = AdapterDeps(settings=_settings(), catalog=_Catalog(_assigned()))
    endpoint = resolve_embedding_endpoint(deps)
    assert endpoint is not None
    assert endpoint.model == "catalog-embed"
    assert endpoint.dimensions == 8
    embedder = build_openai_embedding(deps)
    assert embedder is not None
    assert embedder.is_ready is True
    assert embedder.model == "catalog-embed"


def test_the_embedding_route_is_absent_without_catalog_or_environment() -> None:
    assert build_openai_embedding(AdapterDeps(settings=_settings())) is None
    # 有目录就装得出来，只是此刻不能算
    made = build_openai_embedding(
        AdapterDeps(settings=_settings(), catalog=_Catalog())
    )
    assert made is not None
    assert made.is_ready is False
