"""运行参数在采集侧的取值：计划里的覆盖值优先，本进程环境变量兜底。

平台只下发**被改过的**键（稀疏）；没覆盖的键读不到，调用方回落到自己的
Options / Settings 默认值。分组与键名和 platform 的参数目录**逐字一致**——
服务之间不许互相 import，这份是复述，两边各自有用例钉住。
"""

from typing import Protocol

from collectwire import CollectPlan

SECTION_COLLECT = "collect"
SECTION_ARCHIVE = "archive"

# collect 组
KEY_SNAPSHOT_FLUSH_MS = "snapshot_flush_interval_ms"
KEY_SNAPSHOT_TTL_S = "snapshot_ttl_s"
KEY_HEARTBEAT_S = "heartbeat_interval_s"
KEY_MAX_BACKOFF_S = "reconnect_max_backoff_s"
KEY_PLAN_REFRESH_S = "plan_refresh_interval_s"

# archive 组
KEY_ARCHIVE_ENABLED = "enabled"
KEY_WRITER_FLUSH_MS = "writer_flush_interval_ms"
KEY_BATCH_ROWS = "batch_rows"
KEY_STREAM_MAXLEN = "stream_maxlen"
KEY_BUFFER_MAX_ROWS = "buffer_max_rows"


class PlanView(Protocol):
    """当前计划的只读面。真实现是 `PlanStore`。"""

    @property
    def current(self) -> CollectPlan | None: ...


def _raw(
    plan: CollectPlan | None, section: str, key: str
) -> bool | int | float | None:
    """计划里某个覆盖值的原样取出；没计划或没覆盖给 None。

    Args: plan, section, key。
    """
    if plan is None:
        return None
    return plan.params.get(section, {}).get(key)


def int_param(plan: CollectPlan | None, section: str, key: str) -> int | None:
    """整型覆盖值；没覆盖或形状不对给 None（回落默认值）。

    ⚠ bool 是 int 的子类，必须挡掉——`true` 静默变 1 是最难查的那类错。
    Args: plan, section, key。
    """
    value = _raw(plan, section, key)
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def float_param(
    plan: CollectPlan | None, section: str, key: str
) -> float | None:
    """数值覆盖值（int 亦可）；没覆盖或形状不对给 None。

    Args: plan, section, key。
    """
    value = _raw(plan, section, key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def bool_param(plan: CollectPlan | None, section: str, key: str) -> bool | None:
    """开关覆盖值；没覆盖或形状不对给 None。

    Args: plan, section, key。
    """
    value = _raw(plan, section, key)
    return value if isinstance(value, bool) else None
