"""platform-server 的配置。继承 lib 的基类，只加本服务字段。

变量名 = `PLATFORM_<组>_<键>`。密钥类一律无默认值——缺失即拒绝启动。
"""

from pydantic import Field, SecretStr
from pydantic_settings import SettingsConfigDict

from lib.config import AppSettings, PostgresSettings, SqlServerSettings

SERVICE_NAME = "platform-server"
API_PREFIX = "/api/v1/platform"
DB_SCHEMA = "platform"


class Settings(AppSettings, PostgresSettings, SqlServerSettings):
    """进程启动时构造一次并冻结。"""

    model_config = SettingsConfigDict(
        env_prefix="PLATFORM_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    app_name: str = SERVICE_NAME
    app_http_port: int = 8005
    postgres_schema: str = DB_SCHEMA

    # 边缘注入身份头时用的签名密钥，必须与 auth-server 取同一个值：
    # 少配一边就是全链路 401，而现象与原因隔得极远
    edge_signing_secret: SecretStr = Field(min_length=32)

    # ⚠ 外部只读库的 CT 列是 naive 的当地时间，库里没有时区信息。对外一律 UTC，
    # 换算基准因此必须是配置项；见 docs/AC_DATA_DESIGN.md §6
    acsource_timezone: str = "Asia/Shanghai"
