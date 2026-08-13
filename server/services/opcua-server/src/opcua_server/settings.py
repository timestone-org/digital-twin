"""opcua-server 的配置。继承 lib 的基类，只加本服务字段。

变量名 = `OPCUA_<组>_<键>`。密钥类一律无默认值——缺失即拒绝启动。
端口池与 PKI 目录是**部署期常量**：容器端口映射与挂载卷决定了它们的取值，
运行期开不出池外的端口，见 CONTEXT.md §2。
"""

from pathlib import Path

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import SettingsConfigDict

from lib.config import AppSettings, PostgresSettings, RedisSettings

SERVICE_NAME = "opcua-server"
API_PREFIX = "/api/v1/opcua"
INTERNAL_PREFIX = "/internal/v1"
DB_SCHEMA = "opcua"

# `4840-4859` 这样的闭区间，与容器的端口段映射逐字对应
POOL_PARTS = 2
PORT_MIN = 1
PORT_MAX = 65535
# 低于这个窗口，合并推送就退化成逐次推送，失去节流的意义
PUBLISH_WINDOW_FLOOR_MS = 200


class MigrationSettings(PostgresSettings):
    """迁移只需要连库这一组。

    ⚠ 刻意**不**继承完整 `Settings`：跑一次建表与连边缘签名、Redis 毫无
    关系，而配置的口径是「缺一个就退出」。让迁移依赖整份配置的后果是——
    任何只配了数据库的场合（CI 的迁移作业、部署时先建表再起服务、本地
    对着一个空库验可逆性）都会以「Field required」失败，而报出来的字段
    与建表这件事完全对不上号。
    """

    model_config = SettingsConfigDict(
        env_prefix="OPCUA_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    postgres_schema: str = DB_SCHEMA


class Settings(AppSettings, PostgresSettings, RedisSettings):
    """进程启动时构造一次并冻结。"""

    model_config = SettingsConfigDict(
        env_prefix="OPCUA_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    app_name: str = SERVICE_NAME
    app_http_port: int = 8008
    postgres_schema: str = DB_SCHEMA

    # 边缘注入的 X-Auth-* 头的签名密钥，与 auth-server 同值。
    # ⚠ 这条回退链必须每个服务都写全：少写一处就是非对称失效——
    # 发送端有值、接收端没有，表现为一律 403，而现象与原因隔得极远。
    edge_signing_secret: SecretStr = Field(min_length=32)
    # /internal/ 的服务级密钥，逐字 compare_digest 比较。未配置一律拒绝。
    edge_service_key: SecretStr = Field(min_length=32)

    # opc.tcp 端口池。⚠ 必须与容器端口段映射一致：池外端口没有映射出去，
    # 实例会「显示运行中但连不上」。池满一律拒绝创建，不静默降级。
    port_pool: str = "4840-4859"
    # 单进程内同时运行的实例数上限。asyncio 单线程，实例过多会互相拖慢。
    max_instances: int = Field(default=16, ge=1, le=64)

    # 服务器证书与私钥的挂载卷。私钥只在这里——进库会随数据库备份外流。
    pki_dir: Path = Path("/var/lib/opcua/pki")
    # 自签证书的有效期；到期前要能不停机换发
    cert_valid_days: int = Field(default=825, ge=1)

    # realtime-hub 的地址。实例生灭时登记/注销主题、值变化批推都打它。
    # ⚠ 不可达时**不阻断建实例**：降级方向是「少一个实时通道」，不是
    # 「建不了实例」。缺的主题由启动时的对账补上。
    realtime_base_url: str = "http://realtime-hub:8000"
    realtime_timeout_s: float = Field(default=2.0, gt=0)

    # 值变化推送的合并窗口。上位机可以每秒写几十次，逐次推送会打爆通道。
    publish_window_ms: int = Field(default=1000, ge=PUBLISH_WINDOW_FLOOR_MS)
    # 单条推送消息里最多带几个节点，超出分片并标注
    publish_max_nodes: int = Field(default=500, ge=1)

    @field_validator("port_pool")
    @classmethod
    def _pool_is_a_closed_range(cls, value: str) -> str:
        """端口池必须是 `<起>-<止>` 且起 ≤ 止。

        Args: value。
        """
        parts = value.split("-")
        if len(parts) != POOL_PARTS:
            raise ValueError("端口池应为 `<起>-<止>`，如 4840-4859")
        try:
            low, high = int(parts[0]), int(parts[1])
        except ValueError as error:
            raise ValueError("端口池的两端必须是整数") from error
        if not (PORT_MIN <= low <= high <= PORT_MAX):
            raise ValueError(
                f"端口池必须落在 {PORT_MIN}-{PORT_MAX} 且起不大于止"
            )
        return value

    @model_validator(mode="after")
    def _pool_covers_max_instances(self) -> "Settings":
        """池里的端口数必须够 `max_instances` 个实例用。

        ⚠ 配少了不会在启动时报错，而是在建到第 N+1 个实例时才失败——
        那时现场已经在用了。所以在启动期就把它判死。
        """
        available = len(self.ports())
        if available < self.max_instances:
            raise ValueError(
                f"端口池只有 {available} 个端口，"
                f"少于 max_instances={self.max_instances}"
            )
        return self

    def ports(self) -> tuple[int, ...]:
        """池内的全部端口，按升序。"""
        low, high = (int(part) for part in self.port_pool.split("-"))
        return tuple(range(low, high + 1))
