"""模型目录接进助手（ADR-0039 / ADR-0040）：目录里配出来的每一路各是一个档位。

守的是几件只在现场才看得见的事：界面上配出来的那一路要真的成为一个能选的档位
（而不是仍旧只有环境变量那一路）；一路之内逐档挑模型，挑不出接图模型的那一路
要**如实拒**而不是把图喂给一个不接图的模型（它只会回一句「我没看到图」，
而调用照样计费）；环境变量那两路按形态逐格让位——配了一路订阅账号不该把好端端
的按量那一路挤没；以及每个异步入口先让目录刷新一次。
"""

from typing import Any

import pytest
from pydantic import SecretStr

from ai_assistant.apps.chat.services import model_profiles
from ai_assistant.llm import (
    CODEX_PROFILE,
    DEFAULT_PROFILE,
    AdapterDeps,
    ModelChoice,
    ModelRejected,
)
from ai_assistant.llm.adapters import (
    build_openai_embedding,
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
CHAT = ModelSpec(name="catalog-chat", kind="chat", has_vision=True)
BLIND = ModelSpec(name="blind-chat", kind="chat")
EMBED = ModelSpec(name="catalog-embed", kind="embedding", dimensions=8)
CODEX_MODEL = ModelSpec(name="gpt-5-codex", kind="chat")


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


class _Tokens:
    """凭据面的替身：只回答「取一份能用的令牌」。"""

    async def usable(self, provider: str) -> Any:
        del provider
        raise AssertionError("这几条用例不该真去取令牌")


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


def _env(**overrides: object) -> Settings:
    """环境变量里配好了按量那一路的配置。"""
    return _settings(
        model_enabled=True,
        model_api_key=SecretStr("sk-env"),
        model_chat="env-chat",
        **overrides,
    )


def _endpoint_provider(
    *,
    id: str = "p1",
    name: str = "百炼",
    models: tuple[ModelSpec, ...] = (CHAT, EMBED),
) -> ProviderSpec:
    return ProviderSpec(
        id=id,
        name=name,
        kind="openai_compat",
        base_url="https://catalog/v1",
        api_key=SecretStr("sk-catalog"),
        is_enabled=True,
        models=models,
        extra_body={"enable_thinking": False},
    )


def _codex_provider(
    *, options: dict[str, Any] | None = None, is_enabled: bool = True
) -> ProviderSpec:
    return ProviderSpec(
        id="p2",
        name="我的 Codex",
        kind="codex_oauth",
        base_url="",
        api_key=SecretStr(""),
        is_enabled=is_enabled,
        models=(CODEX_MODEL,),
        options=options,
    )


def _catalog(
    *providers: ProviderSpec, assignments: tuple[Assignment, ...] = ()
) -> ModelCatalog:
    return ModelCatalog(
        providers=providers, assignments=assignments, version="v1"
    )


def _registry(catalog: ModelCatalog, settings: Settings) -> ModelRegistry:
    return ModelRegistry(
        AdapterDeps(
            settings=settings, tokens=_Tokens(), catalog=_Catalog(catalog)
        )
    )


def test_each_configured_provider_becomes_a_profile() -> None:
    """⚠ 档位就是供应商：界面上配出来的那一路要真的能在面板里选中，
    否则「配了一路新的」在使用侧一点迹象都没有。"""
    registry = _registry(
        _catalog(_endpoint_provider(), _codex_provider()), _settings()
    )
    listed = registry.profiles()
    assert [one.id for one in listed] == ["p1", "p2"]
    assert [one.label for one in listed] == ["百炼", "我的 Codex"]


async def test_an_assigned_purpose_picks_that_model_on_that_route() -> None:
    catalog = _catalog(
        _endpoint_provider(models=(BLIND, CHAT)),
        assignments=(Assignment("assistant.chat", "p1", "catalog-chat"),),
    )
    built = await _registry(catalog, _settings()).resolve(
        ModelChoice(profile="p1")
    )
    assert (
        built.model_name == "catalog-chat"
    )  # pyright: ignore[reportAttributeAccessIssue]


async def test_an_unassigned_kind_falls_back_within_the_same_route() -> None:
    """⚠ 折叠摘要那一档没分配时留在**本路**：跑到别处去的话，
    会话选的那一路与真正发出去的那一路就对不上了。"""
    catalog = _catalog(_endpoint_provider(models=(BLIND, CHAT)))
    built = await _registry(catalog, _env()).resolve(
        ModelChoice(profile="p1", kind="summary")
    )
    assert (
        built.model_name == "blind-chat"
    )  # pyright: ignore[reportAttributeAccessIssue]


async def test_a_route_without_a_vision_model_refuses_the_vision_kind() -> None:
    """⚠ 如实拒：喂给一个不接图的模型时它只回一句「我没看到图」，
    而调用成功、照常计费、结论是错的。"""
    catalog = _catalog(_endpoint_provider(models=(BLIND,)))
    registry = _registry(catalog, _settings())
    assert registry.supports("p1", "vision") is False
    with pytest.raises(ModelRejected, match="不接图"):
        await registry.resolve(ModelChoice(profile="p1", kind="vision"))


def test_the_environment_route_steps_aside_for_its_own_kind() -> None:
    """⚠ 按形态逐格让位：配了一路订阅账号不该把好端端的按量那一路挤没。"""
    with_endpoint = _registry(_catalog(_endpoint_provider()), _env())
    assert [one.id for one in with_endpoint.profiles()] == ["p1"]
    with_codex = _registry(_catalog(_codex_provider()), _env())
    assert [one.id for one in with_codex.profiles()] == ["p2", DEFAULT_PROFILE]


def test_an_empty_catalog_leaves_both_environment_routes_alone() -> None:
    registry = _registry(
        EMPTY_CATALOG,
        _env(
            codex_enabled=True,
            codex_model="env-codex",
            credential_secret=SecretStr("c" * 32),
        ),
    )
    assert [one.id for one in registry.profiles()] == [
        DEFAULT_PROFILE,
        CODEX_PROFILE,
    ]


def test_a_disabled_provider_is_not_a_profile() -> None:
    registry = _registry(
        _catalog(_codex_provider(is_enabled=False)), _settings()
    )
    assert registry.profiles() == ()


def test_an_unknown_kind_is_absent_rather_than_guessed() -> None:
    """⚠ 平台那边加了一档而这一侧还没接时，正确的行为是如实缺席——
    拿端点那一路的接法去打一个不是那么接的地方，报出来的错指不回这里。"""
    strange = ProviderSpec(
        id="p9",
        name="将来某一家",
        kind="something_new",
        base_url="",
        api_key=SecretStr(""),
        is_enabled=True,
        models=(CHAT,),
    )
    assert _registry(_catalog(strange), _settings()).profiles() == ()


def test_a_codex_route_reports_its_own_models_and_efforts() -> None:
    registry = _registry(
        _catalog(_codex_provider(options={"default_effort": "high"})),
        _settings(),
    )
    profile = registry.profiles()[0]
    assert profile.models == ("gpt-5-codex",)
    assert profile.has_vision is False
    assert profile.efforts == ("low", "medium", "high", "xhigh")


def test_a_codex_route_needs_the_credential_face() -> None:
    """没接凭据面时那一路不出现：登录都无处可存。"""
    registry = ModelRegistry(
        AdapterDeps(
            settings=_settings(), catalog=_Catalog(_catalog(_codex_provider()))
        )
    )
    assert registry.profiles() == ()


def test_the_login_routes_are_named_for_the_credential_face() -> None:
    """⚠ 凭据面按它认路：写死一份档位名的话，目录里新配的那一路永远登录不了。"""
    registry = _registry(
        _catalog(_endpoint_provider(), _codex_provider()), _settings()
    )
    assert registry.login_refs() == ("p2",)


def test_the_default_follows_the_chat_assignment() -> None:
    """⚠ 默认那一路由**配置**说了算：钉死一个偏好的话，界面上改了分配、
    新会话仍旧走老那一路，而差异只出现在账单上。"""
    catalog = _catalog(
        _endpoint_provider(),
        _endpoint_provider(id="p3", name="另一家"),
        assignments=(Assignment("assistant.chat", "p3", "catalog-chat"),),
    )
    assert _registry(catalog, _settings()).default_id() == "p3"


def test_the_default_stays_on_something_usable() -> None:
    """⚠ 分配指的那一路此刻用不了时退到能用的：把默认钉在一个点了就报错的
    选项上，等于整套助手开箱即坏。"""
    catalog = _catalog(
        _endpoint_provider(),
        _codex_provider(),
        assignments=(Assignment("assistant.chat", "p2", "gpt-5-codex"),),
    )
    registry = _registry(catalog, _settings())
    assert registry.default_id(ready_ids=["p1"]) == "p1"


def test_the_adapters_are_rebuilt_when_the_catalog_changes() -> None:
    """⚠ 按目录版本重装：从不重装的话改了配置要重启才生效，
    每次都重装的话一个回合里的每一次调用都在造新对象。"""
    source = _Catalog(_catalog(_endpoint_provider()))
    registry = ModelRegistry(
        AdapterDeps(settings=_settings(), tokens=_Tokens(), catalog=source)
    )
    first = registry.adapters()
    assert registry.adapters() is first
    source.catalog = ModelCatalog(
        providers=(_endpoint_provider(id="p5", name="换了一家"),),
        assignments=(),
        version="v2",
    )
    assert [one.id for one in registry.adapters()] == ["p5"]


async def test_resolving_refreshes_the_catalog_first() -> None:
    source = _Catalog(_catalog(_endpoint_provider()))
    registry = ModelRegistry(AdapterDeps(settings=_settings(), catalog=source))
    built = await registry.resolve(ModelChoice(profile="p1"))
    assert source.refreshed == 1
    assert (
        built.model_name == "catalog-chat"
    )  # pyright: ignore[reportAttributeAccessIssue]


async def test_listing_profiles_refreshes_the_catalog_first() -> None:
    source = _Catalog(_catalog(_endpoint_provider()))
    registry = ModelRegistry(AdapterDeps(settings=_settings(), catalog=source))
    listed = await model_profiles.profiles_of(registry, None)
    assert source.refreshed == 1
    assert listed[0].models == ["catalog-chat"]


def test_the_embedding_route_follows_the_catalog_too() -> None:
    deps = AdapterDeps(
        settings=_settings(),
        catalog=_Catalog(
            _catalog(
                _endpoint_provider(),
                assignments=(
                    Assignment("assistant.embedding", "p1", "catalog-embed"),
                ),
            )
        ),
    )
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
