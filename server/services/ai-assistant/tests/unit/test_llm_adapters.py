"""模型适配器：哪一路接得上、每一档实际打哪个端点。

守两件事。一是「接不上就不造对象」——抛在装配期会让整个服务起不来，而会话
历史在没有模型时仍然要能读。二是**视觉档的回落链逐格成立**：回落写漏一格的
表现是非对称失效（改了对话档的地址，看图那一档还在打旧的），而两边都不报错。
"""

from pydantic import SecretStr

from ai_assistant.container import build_container
from ai_assistant.llm import (
    MODEL_KINDS,
    ModelAdapter,
    ModelChoice,
    ModelKind,
)
from ai_assistant.llm.adapters import (
    ADAPTER_BUILDERS,
    build_adapters,
    build_openai_compat,
)
from ai_assistant.llm.reasoning import ReasoningChatOpenAI
from ai_assistant.settings import Settings

PLACEHOLDER = "ai-assistant-test"


def _settings(
    *,
    model_enabled: bool = False,
    model_api_key: SecretStr | None = None,
    model_chat: str = "chat-model",
    model_vision: str = "vision-model",
    **overrides: object,
) -> Settings:
    """占位配置，模型那几项由调用方指定。

    Args: model_enabled, model_api_key, model_chat, model_vision, overrides。
    """
    base: dict[str, object] = {
        "postgres_host": PLACEHOLDER,
        "postgres_user": PLACEHOLDER,
        "postgres_password": SecretStr(PLACEHOLDER),
        "postgres_db": PLACEHOLDER,
        "redis_host": PLACEHOLDER,
        "edge_signing_secret": SecretStr("s" * 32),
        "edge_service_key": SecretStr("k" * 32),
        "model_enabled": model_enabled,
        "model_api_key": model_api_key,
        "model_chat": model_chat,
        "model_vision": model_vision,
    }
    base.update(overrides)
    return Settings(
        **base
    )  # pyright: ignore[reportArgumentType]  # 理由：用例造件按名传参


def _enabled(**overrides: object) -> Settings:
    return _settings(
        model_enabled=True, model_api_key=SecretStr("sk-x"), **overrides
    )


async def _built(adapter: ModelAdapter, kind: ModelKind) -> ReasoningChatOpenAI:
    """造出来那一个，收窄成具体类型好断言它的每一格。

    Args: adapter, kind。
    """
    made = await adapter.build(ModelChoice(kind=kind))
    assert isinstance(made, ReasoningChatOpenAI)
    return made


def test_a_disabled_model_yields_no_adapter() -> None:
    assert build_openai_compat(_settings()) is None


def test_an_enabled_model_yields_an_adapter() -> None:
    assert build_openai_compat(_enabled()) is not None


async def test_each_kind_resolves_to_its_own_configured_name() -> None:
    adapter = build_openai_compat(
        _enabled(model_chat="talker", model_vision="looker")
    )
    assert adapter is not None
    # 两项默认同值（当前旗舰原生吃图），但各自的取值必须真的被用上——
    # 接错的话「换成更便宜的看图模型」这次配置改动会静默不生效
    assert (await _built(adapter, "chat")).model_name == "talker"
    assert (await _built(adapter, "vision")).model_name == "looker"


async def test_the_client_does_not_retry_on_its_own() -> None:
    adapter = build_openai_compat(_enabled())
    assert adapter is not None
    # 一条链路只有一层负责重试；留着 SDK 自带的会把上游预算悄悄用光三倍
    assert (await _built(adapter, "chat")).max_retries == 0


async def test_vision_falls_back_to_the_chat_endpoint_when_unset() -> None:
    """回落链的默认那一头：没配视觉端点时两档打同一个地址。"""
    adapter = build_openai_compat(_enabled(model_base_url="https://one/v1"))
    assert adapter is not None
    built = await _built(adapter, "vision")
    assert str(built.openai_api_base) == "https://one/v1"


async def test_vision_uses_its_own_endpoint_when_configured() -> None:
    """回落链的另一头：配了就用自己的，这正是「看图换一家」的全部意义。"""
    adapter = build_openai_compat(
        _enabled(
            model_base_url="https://one/v1",
            vision_base_url="https://two/v1",
            vision_api_key=SecretStr("sk-two"),
            vision_model="其他家的看图模型",
            vision_timeout_s=300.0,
        )
    )
    assert adapter is not None
    built = await _built(adapter, "vision")
    assert str(built.openai_api_base) == "https://two/v1"
    assert built.model_name == "其他家的看图模型"
    assert built.request_timeout == 300.0
    # 对话档一格都不受影响
    chat = await _built(adapter, "chat")
    assert str(chat.openai_api_base) == "https://one/v1"


def test_the_vision_key_falls_back_to_the_chat_key_not_to_empty() -> None:
    """⚠ 弱默认的密钥等于没有密钥：回落的是对话档那一把，不是空串。"""
    resolved = _settings(
        model_enabled=True, model_api_key=SecretStr("sk-chat")
    ).endpoint_of("vision")
    assert resolved is not None
    assert resolved.api_key.get_secret_value() == "sk-chat"


def test_an_unconfigured_deployment_has_no_endpoint_at_all() -> None:
    assert _settings().endpoint_of("chat") is None


def test_the_registry_tuple_is_explicit_and_ordered() -> None:
    """注册是显式一步：靠 import 副作用的话，装了哪几路取决于 import 顺序。"""
    assert len(ADAPTER_BUILDERS) == 2


def test_only_the_reachable_routes_are_built() -> None:
    """没接的一路根本不出现——出现了就是一个点了报错的选项。"""
    built = build_adapters(_enabled(), None)
    assert [one.id for one in built] == ["default"]


def test_every_built_adapter_satisfies_the_port() -> None:
    """注册表的实现要真的对得上 Protocol，否则注册表本身就是静默失效点。"""
    for one in build_adapters(_enabled(), None):
        assert isinstance(one, ModelAdapter)


def test_the_container_leaves_the_model_absent_when_it_is_off() -> None:
    assert build_container(_settings()).model is None


def test_the_container_wires_a_guarded_model_when_it_is_on() -> None:
    container = build_container(_enabled())
    assert container.model is not None
    # 断路器跟着模型一起活；每次调用现造一个的话它永远停在 closed
    assert container.model.breaker.state == "closed"


def test_the_container_builds_one_breaker_per_profile_and_kind() -> None:
    """⚠ 少了用途这一维，看图那一档挂掉会把同一路的对话一起短路掉。"""
    container = build_container(_enabled())
    assert container.model is not None
    assert set(container.model.breakers) == {
        ("default", kind) for kind in MODEL_KINDS
    }
