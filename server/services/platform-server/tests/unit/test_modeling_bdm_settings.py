"""BDM 可选配置的启动校验与凭据边界。"""

import pytest
from pydantic import SecretStr, ValidationError

from platform_server.apps.modeling.services.bdm_client import (
    configured_connection,
)
from platform_server.settings import Settings
from unit.wiring_fakes import build_settings


def configured(**changes: object) -> Settings:
    fields = build_settings().model_dump()
    fields.update(
        {
            "bdm_enabled": True,
            "bdm_base_url": "https://bdm.example.test:806",
            "bdm_api_key": SecretStr("k" * 48),
        }
    )
    return Settings(_env_file=None, **(fields | changes))


def test_disabled_integration_does_not_require_credentials() -> None:
    assert configured_connection(build_settings()) is None


def test_enabled_integration_is_configured_without_exposing_the_key() -> None:
    connection = configured_connection(configured())
    assert connection is not None
    assert connection.base_url == "https://bdm.example.test:806"
    assert "k" * 48 not in repr(connection)


@pytest.mark.parametrize(
    "changes",
    [
        {"bdm_base_url": None},
        {"bdm_api_key": None},
        {"bdm_api_key": SecretStr("short")},
        {"bdm_api_key": SecretStr("k" * 257)},
        {"bdm_api_key": SecretStr("k" * 40 + "\x00")},
        {"bdm_api_key": SecretStr("k" * 40 + " ")},
        {"bdm_base_url": "file:///tmp/data"},
        {"bdm_base_url": "http://username:password@example.test"},
        {"bdm_base_url": "http://example.test/path"},
        {"bdm_base_url": "http://example.test?key=secret"},
        {"bdm_base_url": "http://example.test:99999"},
        {"bdm_timezone": "Not/A_Zone"},
        {"bdm_load_timeout_s": 5.0},
        {"bdm_timeout_s": 20.0},
        {"modeling_node_timeout_s": 100.0},
    ],
)
def test_invalid_enabled_configuration_fails_at_startup(
    changes: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        configured(**changes)
