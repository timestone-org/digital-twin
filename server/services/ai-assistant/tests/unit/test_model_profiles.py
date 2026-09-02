"""新会话开箱走哪一路模型。

守的是一条只有账单看得出来的错：界面上摆着「订阅账号」，回合却走按量计费。
根子在两处各算各的默认——能力端点报一份、建会话盖一份。这一组用例把两处钉成
同一份判定，并守住「按量那一路不盖推理档」。
"""

from dataclasses import dataclass

from pydantic import SecretStr

from ai_assistant.apps.chat.api.capabilities import capability_of
from ai_assistant.apps.chat.services import model_profiles
from ai_assistant.llm import CODEX_PROFILE, DEFAULT_PROFILE
from ai_assistant.llm.adapters import AdapterDeps
from ai_assistant.llm.registry import ModelRegistry
from ai_assistant.settings import Settings

SECRET = SecretStr("s" * 32)


class _Tokens:
    """凭据面的替身。装配这一层只用到「它在不在」。"""

    async def usable(
        self, provider: str
    ) -> object:  # pragma: no cover  # 理由：这一层只问「在不在」，不取令牌
        raise AssertionError(f"这一层不该取令牌：{provider}")


@dataclass(frozen=True)
class _Status:
    """登录态的替身。⚠ 只有这一格——这一层看得见令牌的话迟早会摊出去。"""

    is_connected: bool


@dataclass(frozen=True)
class _Logins:
    """登没登录，一句话答完。"""

    is_connected: bool

    async def status(self, provider: str) -> _Status:
        """Args: provider。"""
        assert provider == CODEX_PROFILE
        return _Status(is_connected=self.is_connected)


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "postgres_host": "x",
        "postgres_user": "x",
        "postgres_password": SecretStr("x"),
        "postgres_db": "x",
        "redis_host": "x",
        "edge_signing_secret": SECRET,
        "edge_service_key": SECRET,
        "model_enabled": True,
        "model_api_key": SecretStr("k" * 8),
        "codex_enabled": True,
        "codex_model": "some-codex",
        "credential_secret": SECRET,
    }
    base.update(overrides)
    return Settings(
        **base
    )  # pyright: ignore[reportArgumentType]  # 理由：用例造件按名传参


def _registry(**overrides: object) -> ModelRegistry:
    return ModelRegistry(
        AdapterDeps(settings=_settings(**overrides), tokens=_Tokens())
    )


async def test_a_logged_in_subscription_is_what_gets_stamped_on_a_new_row() -> (
    None
):
    defaults = await model_profiles.defaults_of(
        _registry(), _Logins(is_connected=True), effort="high"
    )

    assert defaults.profile == CODEX_PROFILE
    assert defaults.effort == "high"


async def test_a_subscription_that_never_logged_in_stamps_the_metered_route(
    # 盖上一个点了就报错的档位，等于每条新会话开箱即坏
) -> None:
    defaults = await model_profiles.defaults_of(
        _registry(), _Logins(is_connected=False), effort="high"
    )

    assert defaults.profile == DEFAULT_PROFILE


async def test_the_metered_route_gets_no_effort_stamped(
    # 按量那一路吃不到这一格，盖上去等于在行上记一件不会发生的事
) -> None:
    defaults = await model_profiles.defaults_of(
        _registry(), _Logins(is_connected=False), effort="high"
    )

    assert defaults.effort is None


async def test_no_credential_side_at_all_reads_as_never_logged_in() -> None:
    defaults = await model_profiles.defaults_of(
        _registry(), None, effort="high"
    )

    assert defaults.profile == DEFAULT_PROFILE


async def test_the_stamped_route_is_the_one_the_capability_endpoint_reports(
    # 这一条是那个「显示订阅、实际按量」的根：两处各算各的默认就会漂开，
    # 而漂开之后运行期毫无迹象，只有账单看得出来
) -> None:
    registry = _registry()
    for connected in (True, False):
        logins = _Logins(is_connected=connected)
        listed = await model_profiles.profiles_of(registry, logins)
        reported = capability_of(registry, listed, "high").default_model_id
        stamped = await model_profiles.defaults_of(
            registry, logins, effort="high"
        )

        assert stamped.profile == reported
