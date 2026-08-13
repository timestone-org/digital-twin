"""platform-server 的配置。继承 lib 的基类，只加本服务字段。

变量名 = `PLATFORM_<组>_<键>`。密钥类一律无默认值——缺失即拒绝启动。
"""

from pydantic import Field, SecretStr
from pydantic_settings import SettingsConfigDict

from lib.config import (
    AppSettings,
    PostgresSettings,
    RedisSettings,
    SqlServerSettings,
)

SERVICE_NAME = "platform-server"
API_PREFIX = "/api/v1/platform"
DB_SCHEMA = "platform"

# 运行角色。⚠ 这是部署轴不是环境轴（ARCHITECTURE §3.4）：同一份镜像按角色跑出
# 不同进程，取值差异之外还差在跑什么循环，故它必须是分支而不是参数。
ROLE_API = "api"
ROLE_WORKER = "worker"


class Settings(AppSettings, PostgresSettings, RedisSettings, SqlServerSettings):
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

    # 开机事件抽取的分片队列，见 docs/AC_STARTUP_DESIGN.md §5
    acstartup_stream: str = "platform:ac-startup:shards"
    acstartup_group: str = "ac-startup-workers"
    acstartup_block_ms: int = 5000
    # 多久没确认就算滞留，可以被别的消费者认领回来
    acstartup_claim_idle_ms: int = 60000
    acstartup_prefetch: int = 8
    # ⚠ 一片的总预算必须大于它内部全部外库查询之和：6 台 × 15 s 查询超时 = 90 s
    acstartup_shard_timeout_s: float = 300.0
    # 一台空调一片最多取多少行；一个月按分钟采样约 4.5 万行
    acstartup_max_rows: int = 60000

    # 达标时长模型的训练队列，见 docs/AC_MODEL_DESIGN.md §4
    acmodel_stream: str = "platform:ac-model:train"
    acmodel_group: str = "ac-model-trainers"
    acmodel_block_ms: int = 5000
    # 训练要跑几十秒，认领门槛要比它长得多，否则跑到一半就被别人抢走重训
    acmodel_claim_idle_ms: int = 300000
    acmodel_prefetch: int = 1
    # 一次训练的总预算。⚠ 真实房间全史上万条可用事件，18 次拟合在竞争负载下
    # 是分钟级；这条线是硬故障线，穿了按不可重试标失败
    acmodel_train_timeout_s: float = 900.0
