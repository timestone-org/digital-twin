"""层级图进程与迁移从工作目录读取配置并保留环境变量优先级。"""

import os
from pathlib import Path

import pytest

from hierarchy_server.settings import MigrationSettings, Settings
from lib.config import ConfigError, load_settings

DOTENV = """HIERARCHY_POSTGRES_HOST=database.example
HIERARCHY_POSTGRES_USER=hierarchy_test
HIERARCHY_POSTGRES_PASSWORD=database-test-only
HIERARCHY_POSTGRES_DB=hierarchy_test
HIERARCHY_REDIS_HOST=cache.example
HIERARCHY_REDIS_PASSWORD=null
HIERARCHY_APP_NAME=层级图测试
HIERARCHY_EDGE_SIGNING_SECRET=ssssssssssssssssssssssssssssssss
HIERARCHY_EDGE_SERVICE_KEY=kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
"""


@pytest.fixture(autouse=True)
def dotenv_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    for name in tuple(os.environ):
        if name.startswith("HIERARCHY_"):
            monkeypatch.delenv(name)
    monkeypatch.chdir(tmp_path)
    path = tmp_path / ".env"
    path.write_text(DOTENV, encoding="utf-8")
    return path


@pytest.mark.parametrize(
    "factory", [Settings, MigrationSettings], ids=("application", "migration")
)
def test_loads_dotenv_from_working_directory(
    factory: type[Settings] | type[MigrationSettings],
) -> None:
    settings = load_settings(factory)

    assert settings.postgres_host == "database.example"
    assert settings.postgres_db == "hierarchy_test"
    assert settings.postgres_password.get_secret_value() == "database-test-only"
    assert settings.postgres_schema == "hierarchy"


@pytest.mark.parametrize(
    "factory", [Settings, MigrationSettings], ids=("application", "migration")
)
def test_environment_overrides_dotenv(
    factory: type[Settings] | type[MigrationSettings],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HIERARCHY_POSTGRES_HOST", "environment.example")

    assert load_settings(factory).postgres_host == "environment.example"


def test_dotenv_preserves_utf8_and_nullable_password() -> None:
    settings = load_settings(Settings)

    assert settings.app_name == "层级图测试"
    assert settings.redis_password is None
    assert settings.edge_signing_secret.get_secret_value() == "s" * 32


def test_dotenv_requires_signing_secret(dotenv_file: Path) -> None:
    dotenv_file.write_text(
        "\n".join(
            line
            for line in DOTENV.splitlines()
            if not line.startswith("HIERARCHY_EDGE_SIGNING_SECRET=")
        ),
        encoding="utf-8",
    )

    with pytest.raises(ConfigError, match="HIERARCHY_EDGE_SIGNING_SECRET"):
        load_settings(Settings)
