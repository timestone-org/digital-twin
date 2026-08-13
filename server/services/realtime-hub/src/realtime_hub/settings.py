"""realtime-hub 的配置。继承 lib 的基类，只加本服务字段。

变量名 = `REALTIME_<组>_<键>`。密钥类一律无默认值——缺失即拒绝启动。
"""

from pydantic import Field, SecretStr
from pydantic_settings import SettingsConfigDict

from lib.config import AppSettings, PostgresSettings, RedisSettings

SERVICE_NAME = "realtime-hub"
API_PREFIX = "/api/v1/realtime"
INTERNAL_PREFIX = "/internal/v1"
DB_SCHEMA = "realtime"

# 权限复核间隔的下限。低于它就是每条消息都去查一遍权限，长连接的意义没了
PERMISSION_TTL_FLOOR_S = 5
# 一条推送里最多带几个条目。再多就该由推送方分片——分片是推送方的事
PAYLOAD_ITEM_CEILING = 5000


class MigrationSettings(PostgresSettings):
    """迁移只需要连库这一组。

    ⚠ 刻意**不**继承完整 `Settings`：跑一次建表与 Redis、服务级密钥毫无
    关系，而配置的口径是「缺一个就退出」。让迁移依赖整份配置的后果是——
    任何只配了数据库的场合（CI 的迁移作业、部署时先建表再起服务、本地
    对着空库验可逆性）都会以「Field required」失败，而报出来的字段与建表
    这件事完全对不上号。这条在 opcua-server 上真踩过（#26）。
    """

    model_config = SettingsConfigDict(
        env_prefix="REALTIME_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    postgres_schema: str = DB_SCHEMA


class Settings(AppSettings, PostgresSettings, RedisSettings):
    """进程启动时构造一次并冻结。"""

    model_config = SettingsConfigDict(
        env_prefix="REALTIME_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    app_name: str = SERVICE_NAME
    app_http_port: int = 8000
    postgres_schema: str = DB_SCHEMA

    # 边缘注入的 X-Auth-* 头的签名密钥，与 auth-server 同值。
    # ⚠ 这条回退链必须每个服务都写全：少写一处就是非对称失效——发送端有值、
    # 接收端没有，表现为一律 403，而现象与原因隔得极远。
    edge_signing_secret: SecretStr = Field(min_length=32)
    # /internal/ 的服务级密钥，逐字 compare_digest 比较。未配置一律拒绝。
    edge_service_key: SecretStr = Field(min_length=32)

    # 验 WS 子协议里那枚 access token 的签名。⚠ 必须与 auth-server 同值，
    # 且 issuer 逐字一致——签发方是它，本服务只验不签。
    jwt_secret: SecretStr = Field(min_length=32)
    # 轮换期的旧密钥。⚠ 不给默认值也不许留空串：留空会让「配了旧密钥」与
    # 「没配」分不开，轮换当中旧令牌会被判成伪造。
    jwt_previous_secret: SecretStr | None = None
    jwt_issuer: str = "auth-server"

    # 登记主题时回调 auth-server 校验声明的权限码是否存在于目录。
    # ⚠ 不可达时 fail-closed（拒绝登记），理由见 CONTEXT.md §7。
    auth_base_url: str = "http://auth-server:8001"
    auth_timeout_s: float = Field(default=2.0, gt=0)

    # 权限上下文的复核间隔。到点重新取一次调用者的权限码，不再满足的主题
    # 就地退订——⚠ 不断整条连接，那会牵连用户正在看的其它无关主题。
    permission_ttl_s: int = Field(default=60, ge=PERMISSION_TTL_FLOOR_S)
    # 单条推送的条目上限。超出即拒绝，让推送方去分片。
    max_payload_items: int = Field(default=500, ge=1, le=PAYLOAD_ITEM_CEILING)
    # 跨副本扇出的 Redis 频道前缀。⚠ 与业务无关，只是通道自己的命名空间。
    fanout_channel_prefix: str = "realtime.fanout"

    def verification_keys(self) -> tuple[str, ...]:
        """验签用的密钥序列，轮换期两枚都试。"""
        keys = [self.jwt_secret.get_secret_value()]
        if self.jwt_previous_secret is not None:
            keys.append(self.jwt_previous_secret.get_secret_value())
        return tuple(keys)

    def fanout_channel(self, topic: str) -> str:
        """某个主题的扇出频道名。

        Args: topic。
        """
        return f"{self.fanout_channel_prefix}.{topic}"
