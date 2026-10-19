"""层级图服务配置与固定命名。"""

from pydantic import Field, SecretStr
from pydantic_settings import SettingsConfigDict

from lib.config import AppSettings, PostgresSettings, RedisSettings

SERVICE_NAME: str = "hierarchy-server"
API_PREFIX: str = "/api/v1/hierarchy"
DB_SCHEMA: str = "hierarchy"
HTTP_PORT: int = 8010


class MigrationSettings(PostgresSettings):
    """迁移连接配置。"""

    model_config = SettingsConfigDict(
        env_prefix="HIERARCHY_", extra="ignore", frozen=True
    )
    postgres_schema: str = DB_SCHEMA


class Settings(AppSettings, PostgresSettings, RedisSettings):
    """冻结的进程配置。"""

    model_config = SettingsConfigDict(
        env_prefix="HIERARCHY_", extra="ignore", frozen=True
    )
    app_name: str = SERVICE_NAME
    app_http_port: int = HTTP_PORT
    postgres_schema: str = DB_SCHEMA
    edge_signing_secret: SecretStr = Field(min_length=32)
    edge_service_key: SecretStr = Field(min_length=32)
