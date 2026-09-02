"""能力面把探测结果摊成出参。

守的是一条开箱即坏：默认那一路必须落在**此刻真能用**的档位上。订阅那一路
配了却没登录过时（`is_ready=false`）默认要退回按量——否则用户打开助手看到的
是一个点了就报错的下拉，而报出来的错是「模型暂时不可用」。
"""

from pydantic import SecretStr

from ai_assistant.apps.chat.api.capabilities import capability_of
from ai_assistant.apps.chat.schemas.capability import ModelProfileOut
from ai_assistant.llm import CODEX_PROFILE, DEFAULT_PROFILE
from ai_assistant.llm.adapters import AdapterDeps
from ai_assistant.llm.registry import ModelRegistry
from ai_assistant.settings import Settings

SECRET = SecretStr("s" * 32)


class _Tokens:
    """凭据面的替身。这一层只用到「它在不在」。"""

    async def usable(
        self, provider: str
    ) -> object:  # pragma: no cover  # 理由：能力面只问「在不在」，不取令牌
        raise AssertionError(f"这一层不该取令牌：{provider}")


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


def _profile(profile_id: str, *, is_ready: bool) -> ModelProfileOut:
    return ModelProfileOut(
        id=profile_id, label=profile_id, is_ready=is_ready, has_vision=False
    )


def test_the_subscription_route_is_the_default_once_it_is_logged_in() -> None:
    body = capability_of(
        _registry(),
        [
            _profile(DEFAULT_PROFILE, is_ready=True),
            _profile(CODEX_PROFILE, is_ready=True),
        ],
        "medium",
    )

    assert body.default_model_id == CODEX_PROFILE


def test_a_subscription_that_never_logged_in_does_not_become_the_default(
    # 配了不等于能用：这一格错了，整套助手开箱就是一个点了报错的下拉
) -> None:
    body = capability_of(
        _registry(),
        [
            _profile(DEFAULT_PROFILE, is_ready=True),
            _profile(CODEX_PROFILE, is_ready=False),
        ],
        "medium",
    )

    assert body.default_model_id == DEFAULT_PROFILE
    assert body.is_model_enabled is True


def test_no_usable_route_reads_as_the_model_being_off() -> None:
    body = capability_of(
        _registry(), [_profile(CODEX_PROFILE, is_ready=False)], "medium"
    )

    assert body.is_model_enabled is False


def test_the_default_effort_comes_from_the_deployment_config() -> None:
    body = capability_of(
        _registry(codex_reasoning_effort="high"),
        [_profile(CODEX_PROFILE, is_ready=True)],
        "high",
    )

    assert body.default_effort == "high"
