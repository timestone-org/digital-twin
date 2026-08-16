"""collector-server 的配置。继承 lib 的基类，只加本服务字段。

变量名 = `COLLECT_<组>_<键>`。密钥类一律无默认值——缺失即拒绝启动。
本服务**无业务 HTTP 面**：`app_http_port` 只服务 `/health` 与 `/ready`。
"""

from pydantic import Field, SecretStr
from pydantic_settings import SettingsConfigDict

from lib.config import AppSettings, PostgresSettings, RedisSettings

SERVICE_NAME = "collector-server"
# 只挂探针。业务面在 platform（配置面）与 Redis（快照、命令总线）
API_PREFIX = "/api/v1/collector"
DB_SCHEMA = "collect"
ROLE = "collector"


class MigrationSettings(PostgresSettings):
    """迁移只需要连库这一组。

    ⚠ 刻意**不**继承完整 `Settings`：跑一次建表与 Redis、服务级密钥毫无关系，
    而配置的口径是「缺一个就退出」。让迁移依赖整份配置的后果是——任何只配了
    数据库的场合（CI 的迁移作业、部署时先建表再起服务）都会以「Field
    required」失败，而报出来的字段与建表这件事完全对不上号。
    """

    model_config = SettingsConfigDict(
        env_prefix="COLLECT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    postgres_schema: str = DB_SCHEMA


class Settings(AppSettings, PostgresSettings, RedisSettings):
    """进程启动时构造一次并冻结。"""

    model_config = SettingsConfigDict(
        env_prefix="COLLECT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    app_name: str = SERVICE_NAME
    app_role: str = ROLE
    app_http_port: int = 8007
    postgres_schema: str = DB_SCHEMA

    # 打 platform 的 /internal/ 用的服务级密钥，与 auth-server 同值。
    # ⚠ 这条回退链必须每个服务都写全：少写一处就是非对称失效——发送端没有值、
    # 接收端要求它，表现为拉不到计划因而永久空转，而现象与原因隔得极远。
    edge_service_key: SecretStr = Field(min_length=32)

    # 采集计划的来源。collector 对 platform 的依赖只有这一条（ADR-0001）
    platform_base_url: str = "http://platform-server:8005"
    # 内部 HTTP 的预算，见 runtime-resilience §3.1
    plan_timeout_s: float = Field(default=5.0, gt=0)
    # 定期全量重拉并按版本号比对。不用增量消息——丢一条就永久错位
    plan_refresh_interval_s: float = Field(default=30.0, gt=0)

    # 快照落 Redis 的窗口。窗口内同一点位后值覆盖前值（快照是采样不是事件流）
    flush_interval_ms: int = Field(default=300, ge=50)
    # ⚠ 快照哈希的存活期，每次 flush 续。采集进程死掉后快照跟着过期——
    # 没有它，大屏会拿着一份永不更新的旧值当实时值看
    snapshot_ttl_s: int = Field(default=60, ge=1)

    # 归档总开关的环境变量默认值；界面上的运行参数覆盖值压过它。
    # ⚠ 关掉之后完全没有报错，只是从此不再记录任何历史
    archive_enabled: bool = True
    # 归档缓冲落 Redis Stream 与 Stream 落库之间的两级节奏，见
    # COLLECT_DESIGN.md §4.3 的 ⑥⑦
    archive_flush_ms: int = Field(default=5000, ge=100)
    # ⚠ 归档缓冲的显式行数上限。参考实现这里无上限，落库一卡就无限涨到把
    # 进程撑死；超限丢最旧并计数上报——静默丢弃是最难查的那类问题
    archive_buffer_max: int = Field(default=200_000, ge=1)
    # 一条 Stream 条目与一条 INSERT 各自最多带多少行。写库时再按 asyncpg
    # 的绑定参数上限收一次，见 crud/point_history.py 的 MAX_INSERT_ROWS
    archive_batch_rows: int = Field(default=1000, ge=1)
    # Stream 的条目上限，是 writer 长期落后时最后一道背压。裁掉的是最旧的
    # 条目，因此追不上就是丢历史——buffer 会在流长到顶时响亮告警
    archive_stream_maxlen: int = Field(default=10_000, ge=1)

    # 命令总线取请求的阻塞时长。它同时是关停时最坏要等的一拍
    command_block_s: float = Field(default=1.0, gt=0)
    # 应答键的存活期。发起方已经超时走人的应答不该留在 Redis 里
    command_reply_ttl_s: int = Field(default=60, ge=1)

    # 会话断线重连的退避上限。首次失败从 1s 起指数退避并抖动
    reconnect_max_backoff_s: float = Field(default=60.0, gt=0)
    # 心跳探针周期：探不到就判断线并进重连
    heartbeat_interval_s: float = Field(default=10.0, gt=0)
