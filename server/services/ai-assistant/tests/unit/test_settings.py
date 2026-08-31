"""配置的启动期校验。

守的是 config-and-secrets §3「绝不允许第一次用到时才发现没配」：模型开关开着
却没有密钥，必须在构造配置时就失败，而不是等到第一次对话——那时服务已经接了
流量，失败影响的是真实用户。
"""

import pytest
from pydantic import SecretStr, ValidationError

from ai_assistant.settings import DB_SCHEMA, HTTP_PORT, Settings

PLACEHOLDER = "ai-assistant-test"


def _settings(
    *,
    model_enabled: bool = False,
    model_api_key: SecretStr | None = None,
    model_extra_body: str = "",
    **overrides: object,
) -> Settings:
    """一份只连占位值的配置，模型那几项由调用方指定。

    Args: model_enabled, model_api_key, model_extra_body, overrides。
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
        "model_extra_body": model_extra_body,
    }
    base.update(overrides)
    return Settings(
        **base
    )  # pyright: ignore[reportArgumentType]  # 理由：用例造件按名传参


def test_model_is_off_by_default_and_needs_no_key() -> None:
    settings = _settings()
    assert settings.model_enabled is False
    assert settings.model_api_key is None


def test_model_on_without_key_is_rejected_at_startup() -> None:
    with pytest.raises(ValidationError) as error:
        _settings(model_enabled=True)
    assert "ASSISTANT_MODEL_API_KEY" in str(error.value)


def test_model_on_with_a_blank_key_is_rejected_too() -> None:
    # ⚠ `.env` 里写着 `ASSISTANT_MODEL_API_KEY=` 就是空串，而那是最常见的
    # 「还没填」形态。只判 None 的话它会一路过关，服务照常起、能力面照常说
    # 「接了模型」，而每一次对话都撞 401
    for blank in ("", "   "):
        with pytest.raises(ValidationError) as error:
            _settings(model_enabled=True, model_api_key=SecretStr(blank))
        assert "ASSISTANT_MODEL_API_KEY" in str(error.value)


def test_model_on_with_key_is_accepted() -> None:
    settings = _settings(model_enabled=True, model_api_key=SecretStr("sk-x"))
    assert settings.model_enabled is True
    assert settings.model_api_key is not None


def test_service_defaults_match_the_slot_reserved_by_the_architecture() -> None:
    settings = _settings()
    assert settings.app_http_port == HTTP_PORT
    assert settings.postgres_schema == DB_SCHEMA


def test_an_empty_extra_body_is_simply_not_configured() -> None:
    """留空是最常见的「还没填」形态，不该是一次启动失败。

    ⚠ 这一格声明成 `dict` 的话，`ASSISTANT_MODEL_EXTRA_BODY=` 会在配置源那一层
    就炸，报出来的是一句「解析字段失败」——与「这一格可以不填」完全对不上。
    """
    assert _settings(model_extra_body="").extra_body() is None
    assert _settings(model_extra_body="   ").extra_body() is None


def test_a_json_object_is_handed_to_the_endpoint_as_is() -> None:
    given = _settings(model_extra_body='{"enable_thinking": true}')

    assert given.extra_body() == {"enable_thinking": True}


def test_a_broken_extra_body_refuses_to_start() -> None:
    """配错了就不许起。

    ⚠ 留到第一次对话才发现的话，报出来的是一条模型端点的 400，
    而那与「本地这一格写歪了」看着毫无关系。
    """
    with pytest.raises(ValidationError):
        _settings(model_extra_body="not-json")


def test_extra_body_must_be_an_object_not_a_list() -> None:
    with pytest.raises(ValidationError):
        _settings(model_extra_body="[1, 2]")


def test_a_broken_vision_extra_body_refuses_to_start() -> None:
    """看图那一档与对话档同一条口径：配错了就不许起。"""
    with pytest.raises(ValidationError):
        _settings(vision_extra_body="not-json")


def test_a_separate_vision_endpoint_without_its_own_key_refuses_to_start() -> (
    None
):
    """⚠ 不拦的话，回落会拿对话档那把密钥去打另一家的端点。

    每次看图都撞 401，而那一档刻意不打开断路器（是我们配错了，不是下游不行），
    于是每次都要等一个完整往返才失败——现象是「截图功能时好时坏」，
    与「这一格没填」看着毫无关系。
    """
    with pytest.raises(ValidationError):
        _settings(
            model_enabled=True,
            model_api_key=SecretStr("sk-chat"),
            model_base_url="https://one/v1",
            vision_base_url="https://two/v1",
        )


def test_the_same_endpoint_for_both_kinds_needs_no_second_key() -> None:
    """两档同一家时不必配第二把——那是最常见的部署形态，别给它添麻烦。"""
    settings = _settings(
        model_enabled=True,
        model_api_key=SecretStr("sk-chat"),
        model_base_url="https://one/v1",
        vision_base_url="https://one/v1",
    )
    resolved = settings.endpoint_of("vision")
    assert resolved is not None
    assert resolved.api_key.get_secret_value() == "sk-chat"


def test_an_mcp_server_needing_auth_without_a_token_refuses_to_start() -> None:
    """⚠ 不给 WARN continue：留到运行期的话，那一路每次 `tools/list` 都撞 401、
    断路器打开，现象是「这一路的工具时有时无」，而它指不回这一格。"""
    with pytest.raises(ValidationError):
        _settings(
            mcp_servers=(
                '[{"name":"a","url":"https://a/mcp","is_auth_required":true}]'
            )
        )


def test_an_mcp_server_with_its_token_starts_fine() -> None:
    settings = _settings(
        mcp_servers='[{"name":"a","url":"https://a/mcp","is_auth_required":true}]',
        mcp_tokens=SecretStr('{"a":"tok"}'),
    )
    assert settings.mcp_token_map() == {"a": "tok"}
    assert len(settings.mcp_server_list()) == 1


def test_a_non_http_mcp_url_is_refused() -> None:
    """⚠ MCP 还有 stdio 传输，这套部署不接它——收下的话表现是「配了却一个
    工具都没有」，而那与「server 连不上」长得一模一样（ADR-0031 决策一）。"""
    with pytest.raises(ValidationError):
        _settings(mcp_servers='[{"name":"a","url":"stdio:///usr/bin/thing"}]')


def test_no_mcp_configured_is_simply_empty() -> None:
    """没配就是空，不是失败——装不上就如实缺席。"""
    settings = _settings()
    assert settings.mcp_server_list() == ()
    assert settings.mcp_write_names() == frozenset()
