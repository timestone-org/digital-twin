"""Settings 基类与装载顺序：命令行 > 环境变量 > .env > 代码默认值。

字段名的第一段即变量分组，与 `env_prefix` 拼成 `<SERVICE>_<GROUP>_<KEY>`。
密钥类字段一律无默认值——弱默认的密钥等于没有密钥。
"""

import socket
import sys
from typing import Literal
from urllib.parse import quote

from pydantic import Field, SecretStr, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

LogFormat = Literal["json", "text"]


class ConfigError(RuntimeError):
    """配置不合法。构造时已带上人类可读的逐项说明。"""


def _default_instance() -> str:
    return socket.gethostname()


class AppSettings(BaseSettings):
    """全服务通用的进程级配置。服务侧继承它并追加自己的字段。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    app_name: str = "service"
    app_role: str = "api"
    app_instance: str = Field(default_factory=_default_instance)
    app_log_level: str = "INFO"
    app_log_format: LogFormat = "json"
    app_http_host: str = "0.0.0.0"  # noqa: S104
    app_http_port: int = 8000
    # 优雅关停时等待在途工作的上限，必须小于编排器的宽限期
    app_drain_timeout_s: float = 20.0
    app_trace_sample_ratio: float = Field(default=0.1, ge=0.0, le=1.0)


class PostgresSettings(BaseSettings):
    """数据库连接组。密码无默认值。"""

    postgres_host: str
    postgres_port: int = 5432
    postgres_user: str
    postgres_password: SecretStr
    postgres_db: str
    postgres_schema: str
    postgres_pool_size: int = 10
    postgres_pool_overflow: int = 5
    postgres_connect_timeout_s: float = 5.0
    # 热路径语句超时，见 docs/agents/runtime-resilience.md §3.1
    postgres_statement_timeout_ms: int = 2000
    postgres_lock_timeout_ms: int = 3000

    def dsn(self) -> str:
        """asyncpg 驱动的连接串（含口令，禁止写日志）。

        ⚠ 用户名与口令必须百分号编码：口令里一个 `@` 就会让 host 被解析成
        口令的后半段，报出来的却是「域名解析失败」，与真实原因隔得极远。
        """
        user = quote(self.postgres_user, safe="")
        password = quote(self.postgres_password.get_secret_value(), safe="")
        return (
            f"postgresql+asyncpg://{user}:{password}"
            f"@{self.postgres_host}:{self.postgres_port}"
            f"/{self.postgres_db}"
        )

    def postgres_target(self) -> str:
        """可写进日志的连接目标：只有 host 与库名，没有凭据。

        ⚠ 名字带组前缀是刻意的：Postgres 与 Redis 两个组会被同一个 Settings
        多继承，同名方法会被 MRO 静默遮蔽掉一个。
        """
        return (
            f"{self.postgres_host}:{self.postgres_port}" f"/{self.postgres_db}"
        )


class SqlServerSettings(BaseSettings):
    """只读 SQL Server 连接组。密码无默认值。"""

    sqlserver_host: str
    sqlserver_port: int = 1433
    sqlserver_user: str
    sqlserver_password: SecretStr
    sqlserver_database: str
    sqlserver_login_timeout_s: float = 5.0
    # 聚合类查询预算，见 docs/agents/runtime-resilience.md §3.1
    sqlserver_query_timeout_s: float = 15.0
    sqlserver_pool_size: int = 5
    sqlserver_pool_recycle_s: int = 3600

    def sqlserver_dsn(self) -> str:
        """pymssql 驱动的连接串（含口令，禁止写日志）。

        ⚠ 用户名与口令必须百分号编码：口令里一个 `@` 就会让 host 被解析成
        口令的后半段，报出来的却是「域名解析失败」，与真实原因隔得极远。
        """
        user = quote(self.sqlserver_user, safe="")
        password = quote(self.sqlserver_password.get_secret_value(), safe="")
        return (
            f"mssql+pymssql://{user}:{password}"
            f"@{self.sqlserver_host}:{self.sqlserver_port}"
            f"/{self.sqlserver_database}"
        )

    def sqlserver_target(self) -> str:
        """可写进日志的连接目标：只有 host 与库名，没有凭据。

        ⚠ 名字带组前缀是刻意的：多个连接组会被同一个 Settings 多继承，
        同名方法会被 MRO 静默遮蔽掉一个。
        """
        return (
            f"{self.sqlserver_host}:{self.sqlserver_port}"
            f"/{self.sqlserver_database}"
        )


class RedisSettings(BaseSettings):
    """Redis 连接组。口令可为空（本地无密码实例），但不给弱默认值。"""

    redis_host: str
    redis_port: int = 6379
    redis_password: SecretStr | None = None
    redis_db: int = 0
    redis_timeout_s: float = 1.0

    def url(self) -> str:
        """redis 客户端连接串（含口令，禁止写日志）。口令同样要百分号编码。"""
        secret = self.redis_password
        credentials = (
            f":{quote(secret.get_secret_value(), safe='')}@" if secret else ""
        )
        return (
            f"redis://{credentials}{self.redis_host}:{self.redis_port}"
            f"/{self.redis_db}"
        )

    def redis_target(self) -> str:
        """可写进日志的连接目标。"""
        return f"{self.redis_host}:{self.redis_port}/{self.redis_db}"


def _describe(error: ValidationError, prefix: str) -> str:
    lines = ["配置错误："]
    for item in error.errors():
        location = ".".join(str(part) for part in item["loc"])
        name = f"{prefix}{location}".upper()
        lines.append(f"  {name}: {item['msg']}")
    return "\n".join(lines)


def load_settings[SettingsT: BaseSettings](
    factory: type[SettingsT],
) -> SettingsT:
    """构造配置对象；任何一项不合法就抛 ConfigError 并带逐项说明。

    Args: factory（Settings 子类）。
    """
    try:
        return factory()
    except ValidationError as error:
        prefix = str(factory.model_config.get("env_prefix") or "")
        raise ConfigError(_describe(error, prefix)) from error


def load_settings_or_exit[SettingsT: BaseSettings](
    factory: type[SettingsT],
) -> SettingsT:
    """进程入口用：配置不合法时打印说明并以非零码退出。

    Args: factory。
    """
    try:
        return load_settings(factory)
    except ConfigError as error:
        # 此时日志器尚未装配，只能直写 stderr
        sys.stderr.write(f"{error}\n")
        raise SystemExit(2) from error
