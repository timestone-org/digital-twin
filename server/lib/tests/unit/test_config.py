"""锁住配置装载：缺项即拒绝、密钥无默认值、连接串必须转义凭据。"""

import pytest
from pydantic import SecretStr, ValidationError
from pydantic_settings import SettingsConfigDict

from lib.config import (
    AppSettings,
    ConfigError,
    PostgresSettings,
    RedisSettings,
    load_settings,
    load_settings_or_exit,
)


class Sample(AppSettings, PostgresSettings, RedisSettings):
    model_config = SettingsConfigDict(
        env_prefix="SAMPLE_", env_file=None, extra="ignore", frozen=True
    )

    postgres_schema: str = "sample"


def make(**overrides: object) -> Sample:
    base: dict[str, object] = {
        "postgres_host": "db.internal",
        "postgres_user": "svc",
        "postgres_password": SecretStr("p@ss:w/ord"),
        "postgres_db": "main",
        "redis_host": "cache.internal",
    }
    return Sample(**{**base, **overrides})


def test_missing_required_field_is_reported_with_its_env_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SAMPLE_POSTGRES_HOST", raising=False)
    with pytest.raises(ConfigError) as caught:
        load_settings(Sample)
    assert "SAMPLE_POSTGRES_HOST" in str(caught.value)


def test_dsn_percent_encodes_credentials() -> None:
    # ⚠ 口令里一个 @ 就会让 host 被解析成口令的后半段
    dsn = make().dsn()
    assert dsn == (
        "postgresql+asyncpg://svc:p%40ss%3Aw%2Ford@db.internal:5432/main"
    )


def test_redis_url_percent_encodes_the_password() -> None:
    url = make(redis_password=SecretStr("a@b")).url()
    assert url == "redis://:a%40b@cache.internal:6379/0"


def test_redis_url_without_password_has_no_credentials_section() -> None:
    assert make().url() == "redis://cache.internal:6379/0"


def test_loggable_targets_never_contain_credentials() -> None:
    settings = make(redis_password=SecretStr("a@b"))
    assert "p@ss" not in settings.postgres_target()
    assert "a@b" not in settings.redis_target()
    assert settings.postgres_target() == "db.internal:5432/main"
    assert settings.redis_target() == "cache.internal:6379/0"


def test_secret_never_appears_in_the_repr() -> None:
    assert "p@ss" not in repr(make())


def test_settings_object_is_frozen() -> None:
    settings = make()
    with pytest.raises(ValidationError):
        settings.postgres_host = "other"


def test_trace_sample_ratio_is_bounded() -> None:
    with pytest.raises(ValidationError):
        make(app_trace_sample_ratio=1.5)


def test_load_settings_or_exit_prints_and_exits_non_zero(
    capsys: pytest.CaptureFixture[str],
) -> None:
    # ⚠ 配置不合法必须在启动第一秒响亮失败：日志器此时还没装配，
    # 只能直写 stderr，且退出码非零才会让编排器判定启动失败
    with pytest.raises(SystemExit) as caught:
        load_settings_or_exit(Sample)
    assert caught.value.code == 2
    assert "SAMPLE_POSTGRES_HOST" in capsys.readouterr().err


def test_load_settings_or_exit_returns_the_object_when_valid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name, value in {
        "SAMPLE_POSTGRES_HOST": "db",
        "SAMPLE_POSTGRES_USER": "u",
        "SAMPLE_POSTGRES_PASSWORD": "p",
        "SAMPLE_POSTGRES_DB": "d",
        "SAMPLE_POSTGRES_SCHEMA": "s",
        "SAMPLE_REDIS_HOST": "cache",
    }.items():
        monkeypatch.setenv(name, value)
    assert load_settings_or_exit(Sample).postgres_host == "db"
