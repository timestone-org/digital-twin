"""这套部署接了哪几路模型，以及按名字取出其中一路。

守三条：没接的一路根本不出现在清单里（出现了就是一个点了报错的选项）、
认不出的档位名退回默认那一路（会话里存的名字可能来自上一版配置）、
以及订阅账号那一路**取模型之前先摸一次令牌**——没登录就在这里失败，
而不是等模型端点回一条 401（那条报出来是「模型暂时不可用」）。
"""

from dataclasses import dataclass

import pytest
from pydantic import SecretStr

from ai_assistant.apps.credential.errors import CredentialNotFound
from ai_assistant.llm import CODEX_PROFILE, DEFAULT_PROFILE, ModelChoice
from ai_assistant.llm.registry import ModelRegistry
from ai_assistant.settings import Settings

SECRET = SecretStr("s" * 32)


@dataclass(frozen=True)
class _Token:
    access_token: str = "at-1"
    account_id: str | None = "acc-1"


class _Tokens:
    """凭据面的替身。`is_connected` 为假时像「还没登录过」。"""

    def __init__(self, *, is_connected: bool = True) -> None:
        self.is_connected = is_connected
        self.asked = 0

    async def usable(self, provider: str) -> _Token:
        assert provider == CODEX_PROFILE
        self.asked += 1
        if not self.is_connected:
            raise CredentialNotFound("还没登录")
        return _Token()


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


def _with_codex() -> Settings:
    return _settings(
        codex_enabled=True,
        codex_model="some-codex",
        codex_models="some-codex, another-codex",
        credential_secret=SECRET,
    )


def test_a_deployment_without_a_model_lists_nothing() -> None:
    # 摆出一个点了报错的选项，比干净地不摆更难查
    registry = ModelRegistry(_settings(), tokens=None)
    assert registry.profiles() == ()


def test_the_pay_per_token_route_shows_up_when_it_is_configured() -> None:
    registry = ModelRegistry(_with_openai(), tokens=None)
    assert [one.id for one in registry.profiles()] == [DEFAULT_PROFILE]


def test_the_subscription_route_lists_its_models_and_efforts() -> None:
    registry = ModelRegistry(_with_codex(), tokens=_Tokens())
    codex = next(one for one in registry.profiles() if one.id == CODEX_PROFILE)
    # 配置里写重了只是手滑，不该让下拉里出现两个一样的
    assert codex.models == ("some-codex", "another-codex")
    assert "xhigh" in codex.efforts


def test_the_default_is_the_first_route_that_is_configured() -> None:
    both = ModelRegistry(
        _settings(
            model_enabled=True,
            model_api_key=SecretStr("k" * 8),
            codex_enabled=True,
            codex_model="some-codex",
            credential_secret=SECRET,
        ),
        tokens=_Tokens(),
    )
    assert both.default_id() == DEFAULT_PROFILE


async def test_an_unknown_profile_falls_back_instead_of_blowing_up() -> None:
    # 会话里存的名字可能来自上一版配置：那时该照常能说话
    registry = ModelRegistry(_with_openai(), tokens=None)
    model = await registry.resolve(ModelChoice(profile="没这一路"))
    assert model is not None


async def test_the_subscription_route_touches_the_token_first() -> None:
    tokens = _Tokens()
    registry = ModelRegistry(_with_codex(), tokens=tokens)
    await registry.resolve(ModelChoice(profile=CODEX_PROFILE))
    assert tokens.asked == 1


async def test_a_never_logged_in_subscription_fails_here_not_at_the_endpoint(
    # 等端点回 401 的话，报出来的是「模型暂时不可用」，与「去登录一下」对不上
) -> None:
    registry = ModelRegistry(_with_codex(), tokens=_Tokens(is_connected=False))
    with pytest.raises(CredentialNotFound):
        await registry.resolve(ModelChoice(profile=CODEX_PROFILE))
