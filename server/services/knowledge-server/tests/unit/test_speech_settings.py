"""语音输入的配置校验：开了开关就必须给一个 ws:// 或 wss:// 的地址。"""

import pytest
from pydantic import SecretStr

from knowledge_server.settings import Settings

PLACEHOLDER = "knowledge-test"


def _base() -> dict[str, object]:
    return {
        "postgres_host": PLACEHOLDER,
        "postgres_user": PLACEHOLDER,
        "postgres_password": SecretStr(PLACEHOLDER),
        "postgres_db": PLACEHOLDER,
        "redis_host": PLACEHOLDER,
        "objectstore_endpoint": "http://knowledge-test:9000",
        "objectstore_bucket": PLACEHOLDER,
        "objectstore_access_key": SecretStr(PLACEHOLDER),
        "objectstore_secret_key": SecretStr("s" * 16),
        "edge_signing_secret": SecretStr("s" * 32),
        "edge_service_key": SecretStr("k" * 32),
    }


def test_speech_is_off_by_default_and_the_url_is_not_checked() -> None:
    """关着时地址不校验：没接语音的部署一个字都不用配。"""
    settings = Settings(**_base())  # pyright: ignore[reportArgumentType]
    assert settings.asr_enabled is False
    assert settings.asr_url == ""


def test_enabled_without_a_url_is_rejected() -> None:
    with pytest.raises(ValueError, match="KNOWLEDGE_ASR_URL"):
        Settings(  # pyright: ignore[reportArgumentType]
            **_base(), asr_enabled=True
        )


def test_enabled_with_an_http_url_is_rejected() -> None:
    """⚠ 形状错的地址在启动时就要拦：留到第一次开麦才发现的话，用户看到的
    只是「语音识别此刻不可用」，与 FunASR 真挂了长得一模一样。"""
    with pytest.raises(ValueError, match="ws://"):
        Settings(  # pyright: ignore[reportArgumentType]
            **_base(), asr_enabled=True, asr_url="http://140.80.0.196:10095"
        )


@pytest.mark.parametrize(
    "url", ["ws://140.80.0.196:10095", "wss://asr.example.internal/"]
)
def test_enabled_with_a_ws_url_is_accepted(url: str) -> None:
    settings = Settings(  # pyright: ignore[reportArgumentType]
        **_base(), asr_enabled=True, asr_url=url
    )
    assert settings.asr_enabled is True
    assert settings.asr_final_timeout_s == 5.0
    assert settings.asr_idle_timeout_s == 30.0
    assert settings.asr_max_utterance_s == 60.0
    assert settings.asr_tail_silence_s == 3.0


def test_a_zero_tail_silence_is_rejected() -> None:
    """⚠ 不补静音 FunASR 不给终稿、连最后一个字都丢——0 不是一个合法取值。"""
    with pytest.raises(ValueError, match="asr_tail_silence_s"):
        Settings(  # pyright: ignore[reportArgumentType]
            **_base(), asr_tail_silence_s=0
        )
