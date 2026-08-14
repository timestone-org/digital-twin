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

# ⚠ 逐字复述 `apps/dashboard/catalog.py` 的 `DASHBOARD_EDIT`。功能模块之间只
# 走对方的 `services` 公开面，权限码常量够不着，故只能复述；两边一致由
# `tests/unit/test_runtime_params_catalog.py` 钉死
DASHBOARD_EDIT = "dashboard:edit"
DASHBOARD_VIEW = "dashboard:view"

SECTION_DASHBOARD = "dashboard"

# 取值类型。⚠ 字面量不是数字：数字枚举在两个仓之间对不上号时没有任何提示
ParamKind = Literal["int", "float"]
INT_KIND: ParamKind = "int"
FLOAT_KIND: ParamKind = "float"

Number = int | float


@dataclass(frozen=True)
class ParamSpec:
    """一个可编辑项的登记信息。

    `key` 即配置对象上的字段名，也是对外的键；`read` 是同一个字段的取值口，
    多一个访问器换来的是零 `getattr`，两者对不上由用例钉死。
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
    read: Callable[[Settings], Number]


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

# 全部分组的登记项。新增运行参数只改这里，描述符、白名单与前端清单随之同步
CATALOG: Mapping[str, tuple[ParamSpec, ...]] = MappingProxyType(
    {SECTION_DASHBOARD: _DASHBOARD_SPECS}
)

# 每个分组自己的写权限码。⚠ 眼下全部分组共用一个码，写端点因此可以用一条
# 静态声明兜住；出现第二个不同的码时必须按分组拆路由，否则闸 2 的静态声明
# 覆盖不到它——这条假设由 `tests/unit/test_runtime_params_catalog.py` 钉死
SECTION_WRITE_CODES: Mapping[str, str] = MappingProxyType(
    {SECTION_DASHBOARD: DASHBOARD_EDIT}
)


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

    Args: spec。
    """
    prefix = Settings.model_config.get("env_prefix") or ""
    return f"{prefix}{spec.key}".upper()
