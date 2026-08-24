"""模型工厂：没开就不造。

守的是「模型没开时服务照常起」：造不出模型这件事要由调用方按「能力缺席」
处理，抛在装配期会让整个服务起不来，而会话历史在没有模型时仍然要能读。
"""

from pydantic import SecretStr

from ai_assistant.container import build_container
from ai_assistant.llm import build_model_source
from ai_assistant.settings import Settings

PLACEHOLDER = "ai-assistant-test"


def _settings(
    *,
    model_enabled: bool = False,
    model_api_key: SecretStr | None = None,
    model_chat: str = "chat-model",
    model_vision: str = "vision-model",
) -> Settings:
    """占位配置，模型那几项由调用方指定。

    Args: model_enabled, model_api_key, model_chat, model_vision。
    """
    return Settings(
        postgres_host=PLACEHOLDER,
        postgres_user=PLACEHOLDER,
        postgres_password=SecretStr(PLACEHOLDER),
        postgres_db=PLACEHOLDER,
        redis_host=PLACEHOLDER,
        edge_signing_secret=SecretStr("s" * 32),
        edge_service_key=SecretStr("k" * 32),
        model_enabled=model_enabled,
        model_api_key=model_api_key,
        model_chat=model_chat,
        model_vision=model_vision,
    )


def test_a_disabled_model_yields_no_source() -> None:
    assert build_model_source(_settings()) is None


def test_an_enabled_model_yields_a_source() -> None:
    source = build_model_source(
        _settings(model_enabled=True, model_api_key=SecretStr("sk-x"))
    )
    assert source is not None


def test_each_kind_resolves_to_its_own_configured_name() -> None:
    source = build_model_source(
        _settings(
            model_enabled=True,
            model_api_key=SecretStr("sk-x"),
            model_chat="talker",
            model_vision="looker",
        )
    )
    assert source is not None
    # 两项默认同值（当前旗舰原生吃图），但各自的取值必须真的被用上——
    # 接错的话「换成更便宜的看图模型」这次配置改动会静默不生效
    assert source("chat").model_name == "talker"
    assert source("vision").model_name == "looker"


def test_the_client_does_not_retry_on_its_own() -> None:
    source = build_model_source(
        _settings(model_enabled=True, model_api_key=SecretStr("sk-x"))
    )
    assert source is not None
    # 一条链路只有一层负责重试；留着 SDK 自带的会把上游预算悄悄用光三倍
    assert source("chat").max_retries == 0


def test_the_container_leaves_the_model_absent_when_it_is_off() -> None:
    assert build_container(_settings()).model is None


def test_the_container_wires_a_guarded_model_when_it_is_on() -> None:
    container = build_container(
        _settings(model_enabled=True, model_api_key=SecretStr("sk-x"))
    )
    assert container.model is not None
    # 断路器跟着模型一起活；每次调用现造一个的话它永远停在 closed
    assert container.model.breaker.state == "closed"
