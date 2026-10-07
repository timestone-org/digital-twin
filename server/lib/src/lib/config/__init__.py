"""配置装载。规范见 docs/agents/config-and-secrets.md。"""

from lib.config.base import (
    AppSettings,
    ConfigError,
    EnvSettings,
    PostgresSettings,
    RedisSettings,
    SqlServerSettings,
    load_settings,
    load_settings_or_exit,
)

__all__ = [
    "AppSettings",
    "ConfigError",
    "EnvSettings",
    "PostgresSettings",
    "RedisSettings",
    "SqlServerSettings",
    "load_settings",
    "load_settings_or_exit",
]
