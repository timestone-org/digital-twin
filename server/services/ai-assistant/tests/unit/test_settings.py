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
) -> Settings:
    """一份只连占位值的配置，模型那几项由调用方指定。

    Args: model_enabled, model_api_key, model_extra_body。
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
        model_extra_body=model_extra_body,
    )


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
