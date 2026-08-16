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

SECTION_DASHBOARD = "dashboard"
# 采集与归档两组的**消费者在 collector-server**：覆盖值随采集计划下发（稀疏），
# 没覆盖的键由 collector 自己的环境变量兜底，默认值列的是出厂值
SECTION_COLLECT = "collect"
SECTION_ARCHIVE = "archive"

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
# `decrease` = 调小危险；None = 任何方向都不需要二次确认
DANGER_OFF = "off"
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
        key="publish_stale_after_ms",
        kind=INT_KIND,
        unit="ms",
        step=1_000,
        minimum=1_000,
        maximum=600_000,
        label="快照陈旧判定",
        hint=(
            "快照多旧就算陈旧。陈旧值照推但会标注为陈旧，前端据此把读数"
            "置灰。调得比采集周期还小会让整屏长期显示为陈旧，调得过大则会"
            "让停止上报的点位看起来仍然正常。"
        ),
        read=lambda settings: settings.publish_stale_after_ms,
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

# 全部分组的登记项。新增运行参数只改这里，描述符、白名单与前端清单随之同步
CATALOG: Mapping[str, tuple[ParamSpec, ...]] = MappingProxyType(
    {
        SECTION_DASHBOARD: _DASHBOARD_SPECS,
        SECTION_COLLECT: _COLLECT_SPECS,
        SECTION_ARCHIVE: _ARCHIVE_SPECS,
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
    }
)

# 两条路由各自服务的分组。⚠ 一个分组只许出现在一个 scope 里
DASHBOARD_SCOPE: tuple[str, ...] = (SECTION_DASHBOARD,)
COLLECT_SCOPE: tuple[str, ...] = (SECTION_COLLECT, SECTION_ARCHIVE)


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
