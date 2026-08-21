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
from lib.objectstore import ObjectStoreSettings

SERVICE_NAME = "platform-server"
API_PREFIX = "/api/v1/platform"
INTERNAL_PREFIX = "/internal/v1/platform"
DB_SCHEMA = "platform"

# 运行角色。⚠ 这是部署轴不是环境轴（ARCHITECTURE §3.4）：同一份镜像按角色跑出
# 不同进程，取值差异之外还差在跑什么循环，故它必须是分支而不是参数。
ROLE_API = "api"
ROLE_WORKER = "worker"
ROLE_PUBLISHER = "publisher"

# 合并窗口的下限。配成 0 会让发布循环空转打满一个核
PUBLISH_WINDOW_FLOOR_MS = 100
# 租约存活期的下限。低于它时一次网络抖动就会丢主
LEASE_TTL_FLOOR_S = 5
# 单帧条目数的上界，取 realtime-hub 的 `max_payload_items` **默认值**（500）。
# ⚠ 只在 hint 里写一句「别超过 hub」是不够的：超了是 hub 那边直接 413 丢整批，
# 现场表现成「大屏少了一半点位」，而排查要走到另一个服务里去。宁可在本进程
# 启动时就拒绝，也不要把错误推到运行期的另一端。
# ⚠ 两边同口径，改一边就要改另一边：hub 自己还能被配到 PAYLOAD_ITEM_CEILING
# （5000），故把 hub 调大之后这里也要跟着放，届时它会明确地拒绝启动而不是静默
PUBLISH_MAX_ITEMS_CEILING = 500


class Settings(
    AppSettings,
    PostgresSettings,
    RedisSettings,
    SqlServerSettings,
    ObjectStoreSettings,
):
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
    # `/internal/` 的服务级密钥，逐字 compare_digest 比较。与 collector-server
    # 的 COLLECT_EDGE_SERVICE_KEY 取同一个值：分叉就是 collector 永远拉不到计划
    edge_service_key: SecretStr = Field(min_length=32)

    # 采集配置面，见 docs/COLLECT_DESIGN.md §5
    # 数据源口令的加密密钥（Fernet 密钥由它派生）。⚠ 密钥类无默认值——缺失即
    # 拒绝启动。换钥后旧密文解不开：计划按未配置凭据下发并响亮记日志，重填即恢复
    collect_credential_secret: SecretStr = Field(min_length=32)
    # 计划变更的广播频道。⚠ pub/sub 即发即弃，collector 仍按周期全量重拉兜底
    collect_plan_channel: str = "collect:plan:changed"
    # 浏览地址空间要走一趟现场设备，预算比别的命令宽
    collect_browse_timeout_s: float = 10.0
    # 一次收齐一棵子树是几百趟设备往返，再单列一档。⚠ 它必须小于浏览器那侧的
    # 请求预算（web 的 `REQUEST_TIMEOUT_MS`），否则界面先放弃、这边还在打设备
    collect_subtree_timeout_s: float = 15.0
    # 连通性测试、寻址串校验、下发写值共用的命令预算
    collect_command_timeout_s: float = 5.0
    # 归档宽表的只读连接池。⚠ 与写库分池：一次跨月扫描不该把写连接一起占住
    collect_history_pool_size: int = 5
    # 时序扫描远慢于热路径写，故语句预算单列一档
    collect_history_statement_timeout_ms: int = 15_000
    # 按天/月聚合的业务时区。⚠ 不带 timezone 的 time_bucket 按 UNIX 纪元对齐，
    # 东八区的日桶会从当地 08:00 开始（docs/COLLECT_DESIGN.md §6）
    collect_bucket_timezone: str = "Asia/Shanghai"
    # 采集配置页的实时值：一个数据源最多推多少个点位（按 code 升序取前 N）。
    # ⚠ 有上限不是省流量：一台设备挂上万个点位时，配置页一屏只看得见几十行，
    # 而全量推会把整条 WS 通道占满。超出的部分由 `SourceOut.live_point_limit`
    # 如实告诉界面，让它说「实时值只覆盖前 N 个点位」——静默截断才是坑
    collect_live_max_points: int = Field(default=1000, ge=1)
    # 点位清单的重读周期。它同时是「新建的点位多久之后开始有实时值」的上界
    collect_live_plan_ttl_s: float = Field(default=10.0, gt=0)

    # 大屏实时发布（publisher 角色），见 docs/DASHBOARD_DESIGN.md §6
    # realtime-hub 的地址。主题登记/注销与批推都打它
    realtime_base_url: str = "http://realtime-hub:8000"
    realtime_timeout_s: float = Field(default=2.0, gt=0)
    # 合并窗口：一拍读一次快照、推一批。⚠ 节流归推送方，hub 一旦知道「哪些
    # 载荷可以合并」就又长出业务知识了（ADR-0007）
    publish_window_ms: int = Field(default=2000, ge=PUBLISH_WINDOW_FLOOR_MS)
    # 单条推送的条目上限。⚠ 必须 ≤ hub 的 REALTIME_MAX_PAYLOAD_ITEMS，超了
    # hub 直接 413——分片是推送方的事，hub 不替谁拆。上界见
    # `PUBLISH_MAX_ITEMS_CEILING`，越界即拒绝启动
    publish_max_items: int = Field(
        default=200, ge=1, le=PUBLISH_MAX_ITEMS_CEILING
    )
    # 单活租约的存活期，续期在每一拍（远快于它）
    publish_lease_ttl_s: int = Field(default=15, ge=LEASE_TTL_FLOOR_S)
    # 主题登记与大屏表的对账周期。⚠ 它同时是「新建的大屏多久之后可被订阅」
    # 的上界：主题未登记时 hub 一律拒订
    publish_reconcile_interval_s: float = Field(default=5.0, gt=0)
    # 订阅关系的只读连接池。realtime schema 归 realtime-hub 写独占
    publish_viewer_pool_size: int = Field(default=2, ge=1)

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
    # 模型压缩任务流。⚠ 与 worker 侧读的是同一对，改一处不改另一处的表现是
    # 「传上去永远在压缩中」，而两边的配置单看都对
    assetcompress_stream: str = "platform:asset:compress"
    assetcompress_group: str = "asset-compress-workers"
    # ⚠ 出厂值是镜像里的落点。本机跑 worker 时要指到仓里那份，否则表现是
    # 每一档都失败、原因是「node: no such file」
    assetcompress_node: str = "node"
    assetcompress_script: str = "/app/nodetools/compress-model.mjs"

    acmodel_stream: str = "platform:ac-model:train"
    acmodel_group: str = "ac-model-trainers"
    acmodel_block_ms: int = 5000
    # 训练要跑几十秒，认领门槛要比它长得多，否则跑到一半就被别人抢走重训
    acmodel_claim_idle_ms: int = 300000
    acmodel_prefetch: int = 1
    # 一次训练的总预算。⚠ 真实房间全史上万条可用事件，18 次拟合在竞争负载下
    # 是分钟级；这条线是硬故障线，穿了按不可重试标失败
    acmodel_train_timeout_s: float = 900.0

    # 预测下发，见 docs/AC_PUBLISH_DESIGN.md §5
    # opcua-server 的地址。⚠ 直连不经边缘：边缘对 `/internal/` 一律 deny。
    # ⚠ 端口是 **8008** 不是 8000——8000 是 realtime-hub 的，两个抄串了的表现是
    # 「校验点位时 opcua-server 不可达」，而两个服务都活得好好的
    opcua_base_url: str = "http://opcua-server:8008"
    opcua_timeout_s: float = Field(default=5.0, gt=0)
    # 一拍多久。⚠ 不做成可配的现场差异——EMS 是逐分钟写入的，调到 5 秒只会
    # 让同一份数据被反复算，并把外库压垮
    acpublish_interval_s: float = Field(default=60.0, gt=0)
    # 一拍的总预算。⚠ 必须小于一拍：跑过头会让下一拍从一开始就迟到，
    # 而迟到会累积。到点即止，没轮到的模型下一拍再说
    acpublish_budget_s: float = Field(default=45.0, gt=0)
    # 单模型一拍的预算，含读 EMS 与写 opcua 两段
    acpublish_model_timeout_s: float = Field(default=20.0, gt=0)
    # 单活租约的存活期，续期在每一拍（远快于它）
    acpublish_lease_ttl_s: int = Field(default=180, ge=LEASE_TTL_FLOOR_S)

    # 开机事件的每日增量，见 docs/AC_PUBLISH_DESIGN.md §6
    acdaily_stream: str = "platform:ac-startup:daily"
    acdaily_group: str = "ac-startup-daily-workers"
    acdaily_block_ms: int = 5000
    acdaily_claim_idle_ms: int = 300000
    acdaily_prefetch: int = 1
    # 一天的窗口比一个月的分片小得多，但仍要大于它内部全部外库查询之和
    acdaily_timeout_s: float = 300.0
    # 调度器多久醒一次看「跨天了没有」。⚠ 它只入队不干活：锁内禁长 IO
    acdaily_scheduler_interval_s: float = Field(default=60.0, gt=0)
    acdaily_lease_ttl_s: int = Field(default=180, ge=LEASE_TTL_FLOOR_S)
