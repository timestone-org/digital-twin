"""守配置的口径：密钥无默认值、缺一项就退出、端口与前缀是约定死的。

⚠ 弱默认的密钥等于没有密钥（config-and-secrets §3）。
"""

import pytest
from pydantic import SecretStr

from collector_server.apps.collect.drivers.base import DriverConnection
from collector_server.settings import (
    API_PREFIX,
    DB_SCHEMA,
    MigrationSettings,
    Settings,
)
from lib.config import ConfigError, load_settings

REQUIRED = {
    "postgres_host": "localhost",
    "postgres_user": "collector",
    "postgres_password": SecretStr("collector"),
    "postgres_db": "collector",
    "redis_host": "localhost",
}


def test_service_takes_the_port_and_schema_of_the_architecture_table(
    settings: Settings,
) -> None:
    assert (settings.app_http_port, settings.postgres_schema) == (
        8007,
        "collect",
    )


def test_probe_prefix_carries_the_service_segment() -> None:
    assert API_PREFIX == "/api/v1/collector"


def test_schema_constant_matches_the_settings_default(
    settings: Settings,
) -> None:
    assert settings.postgres_schema == DB_SCHEMA


def test_service_key_has_no_default(monkeypatch: pytest.MonkeyPatch) -> None:
    # ⚠ 必须先把环境清干净再断言：这条守的是「代码里没给默认值」，
    # 而 pydantic-settings 会去读环境变量与 .env。CI 的作业级 env 里有这一项，
    # 不清就变成在断言「这台机器上没配过它」——本机绿、CI 红
    monkeypatch.delenv("COLLECT_EDGE_SERVICE_KEY", raising=False)
    monkeypatch.chdir("/")
    with pytest.raises(ValueError, match="edge_service_key"):
        Settings(**REQUIRED)


def test_a_short_service_key_is_refused() -> None:
    with pytest.raises(ValueError, match="edge_service_key"):
        Settings(**REQUIRED, edge_service_key=SecretStr("too-short"))


def test_loading_without_configuration_fails_loudly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("COLLECT_POSTGRES_HOST", raising=False)
    monkeypatch.setenv("COLLECT_EDGE_SERVICE_KEY", "x" * 32)
    monkeypatch.chdir("/")
    with pytest.raises(ConfigError):
        load_settings(Settings)


def test_migration_settings_do_not_need_the_service_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name, value in {
        "COLLECT_POSTGRES_HOST": "localhost",
        "COLLECT_POSTGRES_USER": "collector",
        "COLLECT_POSTGRES_PASSWORD": "collector",
        "COLLECT_POSTGRES_DB": "collector",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("COLLECT_EDGE_SERVICE_KEY", raising=False)
    monkeypatch.chdir("/")
    assert load_settings(MigrationSettings).postgres_schema == DB_SCHEMA


def test_flush_window_has_a_floor() -> None:
    with pytest.raises(ValueError, match="flush_interval_ms"):
        Settings(
            **REQUIRED,
            edge_service_key=SecretStr("x" * 32),
            flush_interval_ms=1,
        )


def test_http_network_policy_defaults_to_disabled(settings: Settings) -> None:
    assert settings.http_read_enabled is False
    assert settings.http_allowed_endpoints == ""
    assert settings.http_max_concurrent_requests == 8


@pytest.mark.parametrize("limit", [0, -1, 257])
def test_http_global_concurrency_has_a_valid_range(limit: int) -> None:
    with pytest.raises(ValueError, match="http_max_concurrent_requests"):
        Settings(
            **REQUIRED,
            edge_service_key=SecretStr("x" * 32),
            http_max_concurrent_requests=limit,
        )


@pytest.mark.parametrize(
    "origin",
    [
        "",
        "http://169.254.169.254",
        "ftp://127.0.0.1",
        "http://127.0.0.1:18080/data",
        "http://127.0.0.1:18080?site=1",
        "http://user:secret@127.0.0.1:18080",
    ],
)
def test_http_startup_rejects_missing_or_invalid_origins(origin: str) -> None:
    with pytest.raises(ValueError, match="HTTP"):
        Settings(
            **REQUIRED,
            edge_service_key=SecretStr("x" * 32),
            http_read_enabled=True,
            http_allowed_endpoints=origin,
        )


def test_http_startup_accepts_explicit_normalized_origins() -> None:
    configured = Settings(
        **REQUIRED,
        edge_service_key=SecretStr("x" * 32),
        http_read_enabled=True,
        http_allowed_endpoints=(
            " http://127.0.0.1:18080 , https://api.example.test "
        ),
    )
    assert configured.http_read_enabled is True


def test_driver_connection_repr_does_not_include_credentials() -> None:
    connection = DriverConnection(
        endpoint="http://127.0.0.1:18080", password="sensitive-test-credential"
    )
    assert "sensitive-test-credential" not in repr(connection)
