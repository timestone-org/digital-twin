"""这套部署接了哪几路模型，以及按名字取出其中一路。

守三条：没接的一路根本不出现在清单里（出现了就是一个点了报错的选项）、
认不出的档位名退回默认那一路（会话里存的名字可能来自上一版配置）、
以及订阅账号那一路**取模型之前先领一次令牌**——没登录就在这里失败，
而不是等模型端点回一条 401（那条报出来是「模型暂时不可用」）。

⚠ 订阅账号那一路只从目录里来（ADR-0041）：登录态挂在那一路供应商的行上，
目录之外配出来的那一路无处存登录态。
"""

from dataclasses import dataclass

import pytest
from pydantic import SecretStr

from ai_assistant.llm import (
    DEFAULT_PROFILE,
    AdapterDeps,
    ModelChoice,
    ModelDisabled,
    ModelRejected,
)
from ai_assistant.llm.registry import ModelRegistry
from ai_assistant.settings import Settings
from llmcore import (
    EMPTY_CATALOG,
    CredentialNotConnected,
    ModelCatalog,
    ModelSpec,
    ProviderSpec,
)

SECRET = SecretStr("s" * 32)
# 档位名就是目录里那一路的 id
CODEX_ID = "8f0c1e3a-0000-7000-8000-000000000002"


@dataclass(frozen=True)
class _Token:
    access_token: str = "at-1"
    account_id: str | None = "acc-1"


class _Tokens:
    """令牌来源的替身。`is_connected` 为假时像「还没登录过」。"""

    def __init__(self, *, is_connected: bool = True) -> None:
        self.is_connected = is_connected
        self.asked = 0

    async def usable(self, provider: str) -> _Token:
        assert provider == CODEX_ID
        self.asked += 1
        if not self.is_connected:
            raise CredentialNotConnected("还没登录")
        return _Token()


class _Catalog:
    """目录源的替身：手里一份快照。"""

    def __init__(self, catalog: ModelCatalog) -> None:
        self.catalog = catalog

    def snapshot(self) -> ModelCatalog:
        return self.catalog

    async def refresh(self, *, is_forced: bool = False) -> ModelCatalog:
        del is_forced
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


def _with_openai() -> Settings:
    return _settings(model_enabled=True, model_api_key=SecretStr("k" * 8))


def _codex_catalog() -> ModelCatalog:
    """目录里配了一路订阅账号。"""
    return ModelCatalog(
        providers=(
            ProviderSpec(
                id=CODEX_ID,
                name="我的 Codex",
                kind="codex_oauth",
                base_url="",
                api_key=SecretStr(""),
                is_enabled=True,
                models=(
                    ModelSpec(name="some-codex", kind="chat"),
                    ModelSpec(name="another-codex", kind="chat"),
                ),
            ),
        ),
        assignments=(),
        version="v1",
    )


def _registry(
    settings: Settings,
    *,
    tokens: _Tokens | None = None,
    catalog: ModelCatalog = EMPTY_CATALOG,
) -> ModelRegistry:
    return ModelRegistry(
        AdapterDeps(settings=settings, tokens=tokens, catalog=_Catalog(catalog))
    )


def _codex_registry(*, is_connected: bool = True) -> ModelRegistry:
    return _registry(
        _settings(),
        tokens=_Tokens(is_connected=is_connected),
        catalog=_codex_catalog(),
    )


def test_a_deployment_without_a_model_lists_nothing() -> None:
    # 摆出一个点了报错的选项，比干净地不摆更难查
    assert _registry(_settings()).profiles() == ()


def test_the_pay_per_token_route_shows_up_when_it_is_configured() -> None:
    listed = _registry(_with_openai()).profiles()
    assert [one.id for one in listed] == [DEFAULT_PROFILE]


def test_the_subscription_route_lists_its_models_and_efforts() -> None:
    codex = _codex_registry().profiles()[0]
    assert codex.models == ("some-codex", "another-codex")
    assert "xhigh" in codex.efforts


def _with_both(*, is_connected: bool = True) -> ModelRegistry:
    return _registry(
        _with_openai(),
        tokens=_Tokens(is_connected=is_connected),
        catalog=_codex_catalog(),
    )


def test_a_deployment_without_any_route_still_names_a_default() -> None:
    # 空档位名会被会话原样存下去，然后在取模型那一层变成一条认不出的名字
    assert _registry(_settings()).default_id() == DEFAULT_PROFILE


def test_only_the_pay_per_token_route_means_it_is_the_default() -> None:
    registry = _registry(_with_openai())
    assert registry.default_id(ready_ids=[DEFAULT_PROFILE]) == DEFAULT_PROFILE


def test_only_the_subscription_route_means_it_is_the_default() -> None:
    assert _codex_registry().default_id(ready_ids=[CODEX_ID]) == CODEX_ID


def test_with_both_and_the_subscription_logged_in_it_wins() -> None:
    # 说不清走哪一路时挑按量的，等于每条新会话都在替部署方花钱
    ready = [DEFAULT_PROFILE, CODEX_ID]
    assert _with_both().default_id(ready_ids=ready) == CODEX_ID


def test_a_configured_but_never_logged_in_subscription_is_not_the_default(
    # 「配了」不等于「能用」：默认钉在一个点了就报错的选项上，
    # 等于整套助手开箱即坏
) -> None:
    registry = _with_both(is_connected=False)
    assert registry.default_id(ready_ids=[DEFAULT_PROFILE]) == DEFAULT_PROFILE


def test_when_no_route_is_usable_the_default_still_names_one() -> None:
    """一路都不可用时界面要的是「有这么一路、它没登录」，不是空档位名。"""
    assert _codex_registry().default_id(ready_ids=[]) == CODEX_ID


async def test_an_unknown_profile_falls_back_instead_of_blowing_up() -> None:
    # 会话里存的名字可能来自上一版配置：那时该照常能说话
    model = await _registry(_with_openai()).resolve(
        ModelChoice(profile="没这一路")
    )
    assert model is not None


async def test_the_subscription_route_leases_the_token_first() -> None:
    tokens = _Tokens()
    registry = _registry(_settings(), tokens=tokens, catalog=_codex_catalog())
    await registry.resolve(ModelChoice(profile=CODEX_ID))
    assert tokens.asked == 1


async def test_a_never_logged_in_subscription_fails_here_not_at_the_endpoint(
    # 等端点回 401 的话，报出来的是「模型暂时不可用」，与「去登录一下」对不上
) -> None:
    with pytest.raises(CredentialNotConnected):
        await _codex_registry(is_connected=False).resolve(
            ModelChoice(profile=CODEX_ID)
        )


async def test_the_subscription_route_refuses_an_image_instead_of_sending_it(
    # 这一路自报 has_vision=False，而 dashboard.capture 是页面自报的工具、
    # 不按档位过滤——不在这里拦的话，图会被喂给一个不接图的模型，
    # 而它多半只回一句「我没看到图」：调用成功、照常计费、结论是错的
) -> None:
    """⚠ 拒绝走 `ModelRejected`：那一档不打开断路器，这不是下游不行。"""
    with pytest.raises(ModelRejected) as caught:
        await _codex_registry().resolve(
            ModelChoice(profile=CODEX_ID, kind="vision")
        )
    # 要说清下一步能干什么，否则模型原样再试一次，每次都走完一个回合才失败
    assert "不接图" in str(caught.value)


async def test_the_subscription_route_still_takes_a_chat_turn() -> None:
    """拒的只是看图那一档，别把整路一起关掉。"""
    chosen = await _codex_registry().resolve(ModelChoice(profile=CODEX_ID))
    assert chosen is not None


async def test_a_deployment_without_any_route_says_so_instead_of_crashing(
    # 一路都没接时取模型要给一句能读的话，而不是让调用方吃一个 IndexError
) -> None:
    with pytest.raises(ModelDisabled):
        await _registry(_settings()).resolve(ModelChoice())


def test_the_registry_reports_which_kinds_a_route_takes() -> None:
    """能力面按它如实报，前端才说得出「这一路不接图」。"""
    registry = _with_both()
    assert registry.supports(DEFAULT_PROFILE, "vision") is True
    assert registry.supports(CODEX_ID, "vision") is False


def test_the_registry_answers_which_profile_needs_the_wire_rename() -> None:
    """⚠ 线形改写按它决定：拿档位名与一个写死的字面量比的话，目录里配出来的
    那几路（id 是 uuid）一条都改写不到，而现象是「一带工具就 400」——那条 400
    既不说是哪个工具，也不说问题出在点号上。"""
    registry = _with_both()
    assert registry.is_codex(CODEX_ID) is True
    assert registry.is_codex(DEFAULT_PROFILE) is False


def test_an_unknown_profile_takes_the_wire_rename_of_the_route_it_falls_back_to(
    # 改写按 A 决定、模型是 B 的话，那种错只在带工具的那一轮才现形
) -> None:
    assert _codex_registry().is_codex("上一版配置留下的名字") is True
    assert _registry(_with_openai()).is_codex("同上") is False
