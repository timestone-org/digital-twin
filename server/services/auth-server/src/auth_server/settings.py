"""auth-server 的配置。继承 lib 的基类，只加本服务字段。

变量名 = `AUTH_<组>_<键>`。密钥类一律无默认值——缺失即拒绝启动。
"""

from pydantic import Field, SecretStr
from pydantic_settings import SettingsConfigDict

from lib.config import AppSettings, PostgresSettings, RedisSettings

SERVICE_NAME = "auth-server"
API_PREFIX = "/api/v1/auth"
INTERNAL_PREFIX = "/internal/v1"
DB_SCHEMA = "auth"


class Settings(AppSettings, PostgresSettings, RedisSettings):
    """进程启动时构造一次并冻结。"""

    model_config = SettingsConfigDict(
        env_prefix="AUTH_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    app_name: str = SERVICE_NAME
    app_http_port: int = 8004
    postgres_schema: str = DB_SCHEMA

    # 32 字节以下的 HMAC 密钥低于 HS256 的推荐强度
    jwt_secret: SecretStr = Field(min_length=32)
    # 轮换期同时接受的旧密钥；缺省即不接受旧令牌
    jwt_previous_secret: SecretStr | None = None
    jwt_issuer: str = SERVICE_NAME
    jwt_access_ttl_s: int = 900
    jwt_refresh_ttl_s: int = 1_209_600

    # 边缘注入上游的签名头密钥，与各上游服务共享同一取值
    edge_signing_secret: SecretStr = Field(min_length=32)
    # /internal/ 的服务级密钥，逐字 compare_digest 比较
    edge_service_key: SecretStr = Field(min_length=32)
    edge_permission_ttl_s: int = 60

    login_max_attempts: int = 10
    login_window_s: int = 300

    signup_enabled: bool = False
    signup_max_attempts: int = 5
    signup_window_s: int = 3600
    signup_default_role: str = "viewer"

    def verification_keys(self) -> tuple[str, ...]:
        """令牌校验密钥集：主密钥 + 轮换期的旧密钥。"""
        keys = [self.jwt_secret.get_secret_value()]
        if self.jwt_previous_secret is not None:
            keys.append(self.jwt_previous_secret.get_secret_value())
        return tuple(keys)
