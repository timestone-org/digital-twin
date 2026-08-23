"""参数目录 —— 哪些配置项是**运行参数**（界面可改），以及每项的取值范围。

目录写死在代码里，表里只存被改过的项。一处供三用：读端点的描述符、写端点的
白名单、前端字段清单的权威来源。**没登记的键既不可读也不可写**——密钥、连接
串、角色开关因此天然被排除，不需要另写一套排除逻辑。

⚠ 环境变量是永久默认值而不是一次性播种：这里的 `read` 每次都从当前进程的
配置对象上取，没有任何一步会把它抄进表里。
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal

from platform_server.settings import PUBLISH_MAX_ITEMS_CEILING, Settings

# ⚠ 逐字复述 `apps/dashboard/catalog.py` 的 `DASHBOARD_EDIT` 与
# `apps/collect/catalog.py` 的采集码。功能模块之间只走对方的 `services` 公开面，
# 权限码常量够不着，故只能复述；两边一致由
# `tests/unit/test_runtime_params_catalog.py` 钉死
DASHBOARD_EDIT = "dashboard:edit"
DASHBOARD_VIEW = "dashboard:view"
COLLECT_MANAGE = "collect:manage"
COLLECT_VIEW = "collect:view"
DATASET_MANAGE = "dataset:manage"
DATASET_VIEW = "dataset:view"

SECTION_DASHBOARD = "dashboard"
# 采集与归档两组的**消费者在 collector-server**：覆盖值随采集计划下发（稀疏），
# 没覆盖的键由 collector 自己的环境变量兜底，默认值列的是出厂值
SECTION_COLLECT = "collect"
SECTION_ARCHIVE = "archive"
# 台账聚合采集器那一组。**消费者在本进程**（worker 角色的采集循环），故它每一拍
# 现读一次这一组的有效值——界面上一改，下一拍就生效，不必重启
SECTION_DATASET = "dataset"

# 取值类型。⚠ 字面量不是数字：数字枚举在两个仓之间对不上号时没有任何提示
ParamKind = Literal["int", "float", "switch"]
INT_KIND: ParamKind = "int"
FLOAT_KIND: ParamKind = "float"
SWITCH_KIND: ParamKind = "switch"

Number = int | float
# ⚠ bool 在前：它是 int 的子类，排在后面会被静默收成 0/1
ParamValue = bool | int | float

# 生效档位。非即时档要在界面上如实说「还没生效」
TIER_INSTANT = "instant"
TIER_RECONNECT = "reconnect"
TIER_RESTART = "restart"

# 危险方向：危险性挂在**变更方向**上而不是字段上。`off` = 由开改关危险，
# `on` = 由关改开危险，`decrease` = 调小危险；None = 任何方向都不需要二次确认。
# ⚠ 同为开关，危险方向可以相反：采集开关关掉只是不再出新行，而清理开关**打开**
# 就开始真实删数据。照抄另一个开关的取值等于把二次确认弹在安全的那一侧
DANGER_OFF = "off"
DANGER_ON = "on"
DANGER_DECREASE = "decrease"


@dataclass(frozen=True)
class ParamSpec:
    """一个可编辑项的登记信息。

    `key` 即配置对象上的字段名，也是对外的键；`read` 是同一个字段的取值口，
    多一个访问器换来的是零 `getattr`，两者对不上由用例钉死。
    采集/归档分组的 `read` 回的是**出厂值常量**（消费者在另一个进程），
    对应的环境变量名由 `env_override` 指向 collector 侧。
    """

    section: str
    key: str
    kind: ParamKind
    unit: str
    step: Number
    minimum: Number
    maximum: Number
    label: str
    hint: str
    read: Callable[[Settings], ParamValue]
    tier: str = TIER_INSTANT
    danger: str | None = None
    # 键对应的环境变量全名在**别的服务**上时由它给出（如 COLLECT_*）
    env_override: str | None = None


_DASHBOARD_SPECS: tuple[ParamSpec, ...] = (
    ParamSpec(
        section=SECTION_DASHBOARD,
        key="publish_window_ms",
        kind=INT_KIND,
        unit="ms",
        step=100,
        minimum=100,
        maximum=60_000,
        label="推送合并窗口",
        hint=(
            "发布循环多久醒一次，也就是全平台实时数据的时间分辨率上限——"
            "各数据源只会比它慢，不会比它快。调小会按观看者数量成倍放大"
            "服务端与 Redis 的压力。"
        ),
        read=lambda settings: settings.publish_window_ms,
    ),
    ParamSpec(
        section=SECTION_DASHBOARD,
        key="publish_max_items",
        kind=INT_KIND,
        unit="条",
        step=50,
        minimum=1,
        maximum=PUBLISH_MAX_ITEMS_CEILING,
        label="单帧条目上限",
        hint=(
            "一帧推送最多带多少个点位。⚠ 上限取的是 realtime-hub 的 "
            "REALTIME_MAX_PAYLOAD_ITEMS 默认值：超过它 hub 直接 413 丢整批，"
            "现场表现成「大屏少了一半点位」。分片是推送方的事，hub 不替谁拆。"
        ),
        read=lambda settings: settings.publish_max_items,
    ),
    ParamSpec(
        section=SECTION_DASHBOARD,
        key="publish_reconcile_interval_s",
        kind=FLOAT_KIND,
        unit="s",
        step=1,
        minimum=1,
        maximum=300,
        label="主题对账周期",
        hint=(
            "主题登记与大屏表多久对一次账。⚠ 它同时是「新建的大屏多久之后"
            "可以被订阅」的上界：主题未登记时 hub 一律拒订，调大意味着用户"
            "新建一张屏之后要多等这么久才看得到数据。"
        ),
        read=lambda settings: settings.publish_reconcile_interval_s,
    ),
)

# ── 采集组：消费者是 collector-server 的采集运行时 ─────────────────────
# ⚠ 出厂值与 collector `settings.py` 的默认值逐字同值，两边一致由
# `tests/unit/test_runtime_params_catalog.py` 与 collector 侧的配置用例各自钉死
_COLLECT_SPECS: tuple[ParamSpec, ...] = (
    ParamSpec(
        section=SECTION_COLLECT,
        key="snapshot_flush_interval_ms",
        kind=INT_KIND,
        unit="ms",
        step=50,
        minimum=50,
        maximum=60_000,
        label="快照落盘节拍",
        hint=(
            "点位读数缓冲多久批量落一次 Redis 快照。越小越实时，Redis 压力"
            "越大；设得比大屏推送合并窗口还大，推出去的就都是陈旧快照。"
        ),
        read=lambda _settings: 300,
        tier=TIER_INSTANT,
        env_override="COLLECT_FLUSH_INTERVAL_MS",
    ),
    ParamSpec(
        section=SECTION_COLLECT,
        key="snapshot_ttl_s",
        kind=INT_KIND,
        unit="s",
        step=10,
        minimum=1,
        maximum=86_400,
        label="快照存活期",
        hint=(
            "快照哈希的 TTL，每次落盘续期。采集进程死掉后快照跟着过期——"
            "调得过大，大屏会拿着一份永不更新的旧值当实时值看。"
        ),
        read=lambda _settings: 60,
        tier=TIER_INSTANT,
        env_override="COLLECT_SNAPSHOT_TTL_S",
    ),
    ParamSpec(
        section=SECTION_COLLECT,
        key="heartbeat_interval_s",
        kind=FLOAT_KIND,
        unit="s",
        step=1,
        minimum=1,
        maximum=600,
        label="心跳探测周期",
        hint=(
            "多久探一次设备会话还活着，探不到就进重连。调小发现断线更快，"
            "但每一拍都是一次真实的设备往返。"
        ),
        read=lambda _settings: 10.0,
        tier=TIER_RECONNECT,
        env_override="COLLECT_HEARTBEAT_INTERVAL_S",
    ),
    ParamSpec(
        section=SECTION_COLLECT,
        key="reconnect_max_backoff_s",
        kind=FLOAT_KIND,
        unit="s",
        step=5,
        minimum=1,
        maximum=3_600,
        label="重连退避上限",
        hint=(
            "断线重连的最大间隔（首次失败从 1s 起指数退避）。现场网络频繁"
            "抖动时调大可以少打设备；配置/凭据类错误直接等满这个上限。"
        ),
        read=lambda _settings: 60.0,
        tier=TIER_RECONNECT,
        env_override="COLLECT_RECONNECT_MAX_BACKOFF_S",
    ),
    ParamSpec(
        section=SECTION_COLLECT,
        key="plan_refresh_interval_s",
        kind=FLOAT_KIND,
        unit="s",
        step=5,
        minimum=5,
        maximum=600,
        label="计划刷新周期",
        hint=(
            "采集器多久重拉一次全量计划。它同时是「界面上的改动多久生效」"
            "的上界——包括这一页里其它旋钮的即时档。"
        ),
        read=lambda _settings: 30.0,
        tier=TIER_RESTART,
        env_override="COLLECT_PLAN_REFRESH_INTERVAL_S",
    ),
)

# ── 归档组：消费者是 collector-server 的归档支线 ────────────────────────
_ARCHIVE_SPECS: tuple[ParamSpec, ...] = (
    ParamSpec(
        section=SECTION_ARCHIVE,
        key="enabled",
        kind=SWITCH_KIND,
        unit="",
        step=1,
        minimum=0,
        maximum=1,
        label="归档总开关",
        hint=(
            "关掉之后采集侧在最前端就短路：读数不再进归档缓冲，点位上各自的"
            "「记录历史」一律不生效。⚠ 关闭之后完全没有报错，只是从此不再"
            "记录任何历史。"
        ),
        read=lambda _settings: True,
        tier=TIER_INSTANT,
        danger=DANGER_OFF,
        env_override="COLLECT_ARCHIVE_ENABLED",
    ),
    ParamSpec(
        section=SECTION_ARCHIVE,
        key="writer_flush_interval_ms",
        kind=INT_KIND,
        unit="ms",
        step=500,
        minimum=100,
        maximum=600_000,
        label="落库节拍",
        hint=(
            "归档器多久把 Redis 缓冲批量落一次 TimescaleDB。调大省写放大，"
            "但进程关停时在途的窗口更大。"
        ),
        read=lambda _settings: 5_000,
        tier=TIER_INSTANT,
        env_override="COLLECT_ARCHIVE_FLUSH_MS",
    ),
    ParamSpec(
        section=SECTION_ARCHIVE,
        key="batch_rows",
        kind=INT_KIND,
        unit="行",
        step=100,
        minimum=1,
        maximum=5_000,
        label="单批行数",
        hint=(
            "一条 Stream 条目与一条 INSERT 各自最多带多少行。上限受"
            "PostgreSQL 绑定参数总数约束，不是拍脑袋的数。"
        ),
        read=lambda _settings: 1_000,
        tier=TIER_INSTANT,
        env_override="COLLECT_ARCHIVE_BATCH_ROWS",
    ),
    ParamSpec(
        section=SECTION_ARCHIVE,
        key="stream_maxlen",
        kind=INT_KIND,
        unit="条",
        step=1_000,
        minimum=100,
        maximum=1_000_000,
        label="缓冲流上限",
        hint=(
            "Redis 归档流的近似裁剪上限，是落库长期卡住时的最后一道背压："
            "顶到上限丢最旧并响亮告警，防止共用的 Redis 被撑爆拖垮整栈。"
        ),
        read=lambda _settings: 10_000,
        tier=TIER_INSTANT,
        danger=DANGER_DECREASE,
        env_override="COLLECT_ARCHIVE_STREAM_MAXLEN",
    ),
    ParamSpec(
        section=SECTION_ARCHIVE,
        key="buffer_max_rows",
        kind=INT_KIND,
        unit="行",
        step=10_000,
        minimum=1_000,
        maximum=5_000_000,
        label="进程内缓冲上限",
        hint=(
            "归档缓冲的显式行数上限，满了挤掉最旧并计数上报——静默丢弃是"
            "最难查的那类问题，这里宁可响亮。"
        ),
        read=lambda _settings: 200_000,
        tier=TIER_INSTANT,
        danger=DANGER_DECREASE,
        env_override="COLLECT_ARCHIVE_BUFFER_MAX",
    ),
)

# ── 台账组：消费者是本进程 worker 角色的聚合采集循环 ────────────────────
# ⚠ 键名逐字等于 `Settings` 上的字段名，故环境变量名就是 `PLATFORM_<键大写>`，
# 与 docs/DATASET_DESIGN.md §13 列的那几个一字不差。取值每一拍现读，都是即时档
_DATASET_SPECS: tuple[ParamSpec, ...] = (
    ParamSpec(
        section=SECTION_DATASET,
        key="dataset_enabled",
        kind=SWITCH_KIND,
        unit="",
        step=1,
        minimum=0,
        maximum=1,
        label="台账采集总开关",
        hint=(
            "关掉之后按周期聚合的台账**不再出新行**：水位停在原地，界面上那张"
            "表看起来只是「今天还没有数据」。⚠ 关闭期间的桶不会自己补回来——"
            "重新打开只从当前这一拍往下算，中间那段要人显式触发回填。"
        ),
        read=lambda settings: settings.dataset_enabled,
        tier=TIER_INSTANT,
        danger=DANGER_OFF,
    ),
    ParamSpec(
        section=SECTION_DATASET,
        key="dataset_interval_s",
        kind=FLOAT_KIND,
        unit="s",
        step=5,
        minimum=1,
        maximum=3_600,
        label="采集循环节拍",
        hint=(
            "采集器多久醒一次，扫一遍全部按周期聚合的台账。它是「一个桶关闭"
            "之后多久出行」的上界：比台账周期还大的节拍会让行成批地晚到，"
            "而不是均匀地晚一点。"
        ),
        read=lambda settings: settings.dataset_interval_s,
    ),
    ParamSpec(
        section=SECTION_DATASET,
        key="dataset_recompute_tail_buckets",
        kind=INT_KIND,
        unit="个",
        step=1,
        minimum=0,
        maximum=48,
        label="每拍重算的尾部桶数",
        hint=(
            "每一拍额外重算最近这么多个已关闭的桶，兜住迟到的归档数据。"
            "调到 0 就只算新桶：迟到的样本从此永远进不了台账，而那一格看起来"
            "只是「当时就这么多」。"
        ),
        read=lambda settings: settings.dataset_recompute_tail_buckets,
        danger=DANGER_DECREASE,
    ),
    ParamSpec(
        section=SECTION_DATASET,
        key="dataset_max_buckets_per_tick",
        kind=INT_KIND,
        unit="个",
        step=60,
        minimum=1,
        maximum=10_000,
        label="单表每拍的桶数上限",
        hint=(
            "停机很久之后靠一拍一段往前追，这是每一段的长度。调大追得快但"
            "单次查询更重；调小则追平所需的时间按倍数拉长。"
        ),
        read=lambda settings: settings.dataset_max_buckets_per_tick,
    ),
    ParamSpec(
        section=SECTION_DATASET,
        key="dataset_table_timeout_s",
        kind=FLOAT_KIND,
        unit="s",
        step=5,
        minimum=1,
        maximum=600,
        label="单表每拍的预算",
        hint=(
            "一张台账一拍最多算多久，超了当这一拍没算完、下一拍继续。⚠ 它与"
            "另外五条消费循环共用一个事件循环，没有预算的一次慢查询会把整个"
            "worker 一起拖住。"
        ),
        read=lambda settings: settings.dataset_table_timeout_s,
    ),
    ParamSpec(
        section=SECTION_DATASET,
        key="dataset_retention_enabled",
        kind=SWITCH_KIND,
        unit="",
        step=1,
        minimum=0,
        maximum=1,
        label="保留期清理总开关",
        hint=(
            "打开之后，按每张台账的「保留天数」**真实删除**过期数据行，"
            "删掉的行找不回来。⚠ 保留天数为空的台账是**永久保留**，一律跳过。"
            "拨开之后还要等满一个完整周期才第一次执行，好留出反悔的余地。"
        ),
        read=lambda settings: settings.dataset_retention_enabled,
        tier=TIER_INSTANT,
        # ⚠ 危险方向与采集开关**相反**：这一项打开才是危险的那一侧
        danger=DANGER_ON,
    ),
    ParamSpec(
        section=SECTION_DATASET,
        key="dataset_retention_interval_s",
        kind=FLOAT_KIND,
        unit="s",
        step=3_600,
        minimum=3_600,
        maximum=86_400,
        label="清理周期",
        hint=(
            "两次清理之间至少隔多久。⚠ 这里没有 cron：它保证的是间隔，不保证"
            "在哪个墙钟时刻醒来。它同时是「拨开开关之后多久第一次删」的下界。"
            "上限 24 小时是硬的——租约的存活期按它算出来，调过头就是每一趟都"
            "先把租约丢了。"
        ),
        read=lambda settings: settings.dataset_retention_interval_s,
    ),
    ParamSpec(
        section=SECTION_DATASET,
        key="dataset_retention_max_rows_per_run",
        kind=INT_KIND,
        unit="行",
        step=10_000,
        minimum=1,
        maximum=5_000_000,
        label="单趟实删行数上限",
        hint=(
            "一趟清理最多删多少行，超了就收工、剩下的下一趟继续。⚠ 只在批边界"
            "判定：PostgreSQL 的 DELETE 不能中途叫停，能保证的是「超了不再发下"
            "一条」。触顶会响亮记一条日志，不会静默截断。"
        ),
        read=lambda settings: settings.dataset_retention_max_rows_per_run,
    ),
    ParamSpec(
        section=SECTION_DATASET,
        key="dataset_retention_table_timeout_s",
        kind=FLOAT_KIND,
        unit="s",
        step=30,
        minimum=1,
        maximum=3_600,
        label="单表每趟的预算",
        hint=(
            "一张台账一趟最多删多久，超了当这张表没删完、下一趟继续。⚠ 它与"
            "另外六条循环共用一个事件循环，没有预算的一次慢删除会把整个 worker"
            "一起拖住。"
        ),
        read=lambda settings: settings.dataset_retention_table_timeout_s,
    ),
)

# 全部分组的登记项。新增运行参数只改这里，描述符、白名单与前端清单随之同步
CATALOG: Mapping[str, tuple[ParamSpec, ...]] = MappingProxyType(
    {
        SECTION_DASHBOARD: _DASHBOARD_SPECS,
        SECTION_COLLECT: _COLLECT_SPECS,
        SECTION_ARCHIVE: _ARCHIVE_SPECS,
        SECTION_DATASET: _DATASET_SPECS,
    }
)

# 每个分组自己的写权限码。⚠ 已经不止一个码，路由必须按分组拆：/runtime-params
# 只服务 DASHBOARD_SCOPE，/collect-runtime-params 只服务 COLLECT_SCOPE——闸 2
# 的静态声明挂在路由上，一条路由声明不出两个码。分组落错路由就是拿大屏的码
# 改采集参数，这条对应关系由 `tests/unit/test_runtime_params_catalog.py` 钉死
SECTION_WRITE_CODES: Mapping[str, str] = MappingProxyType(
    {
        SECTION_DASHBOARD: DASHBOARD_EDIT,
        SECTION_COLLECT: COLLECT_MANAGE,
        SECTION_ARCHIVE: COLLECT_MANAGE,
        SECTION_DATASET: DATASET_MANAGE,
    }
)

# 三条路由各自服务的分组。⚠ 一个分组只许出现在一个 scope 里
DASHBOARD_SCOPE: tuple[str, ...] = (SECTION_DASHBOARD,)
COLLECT_SCOPE: tuple[str, ...] = (SECTION_COLLECT, SECTION_ARCHIVE)
DATASET_SCOPE: tuple[str, ...] = (SECTION_DATASET,)


def sections() -> tuple[str, ...]:
    """全部分组名，顺序钉死。"""
    return tuple(CATALOG)


def specs_of(section: str) -> tuple[ParamSpec, ...] | None:
    """一个分组的全部登记项；没有这个分组给 None。

    Args: section。
    """
    return CATALOG.get(section)


def spec_of(section: str, key: str) -> ParamSpec | None:
    """一项的登记信息；没登记给 None。

    Args: section, key。
    """
    for spec in CATALOG.get(section, ()):
        if spec.key == key:
            return spec
    return None


def env_name_of(spec: ParamSpec) -> str:
    """对应的环境变量全名，给运维对着 .env 看。

    采集/归档分组的变量在 collector-server 的 .env 上，由 `env_override` 给出。
    Args: spec。
    """
    if spec.env_override is not None:
        return spec.env_override
    prefix = Settings.model_config.get("env_prefix") or ""
    return f"{prefix}{spec.key}".upper()
