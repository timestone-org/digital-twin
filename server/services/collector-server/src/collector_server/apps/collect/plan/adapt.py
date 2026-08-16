"""计划的形状 → 驱动与收敛决策认识的形状。

协议知识在这里换手：`address` 从这一步之后才被驱动解析（ADR-0011）。
计划本身的形状归 `collectwire`，本模块不复述任何字段名。
"""

from collector_server.apps.collect.drivers.base import (
    DriverConnection,
    DriverTimeouts,
    PointSpec,
)
from collectwire import PlanPoint, PlanSource


def to_spec(point: PlanPoint) -> PointSpec:
    """一个点位交给驱动的那部分。

    Args: point。
    """
    return PointSpec(
        point_code=point.point_code,
        address=point.address,
        sampling_interval_ms=point.sampling_interval_ms,
    )


def specs_of(source: PlanSource) -> tuple[PointSpec, ...]:
    """一个数据源下全部点位的驱动形态。

    Args: source。
    """
    return tuple(to_spec(point) for point in source.points)


def to_connection(
    source: PlanSource, timeouts: DriverTimeouts
) -> DriverConnection:
    """建一次会话要的连接参数。

    Args: source, timeouts。
    """
    return DriverConnection(
        endpoint=source.endpoint,
        options=dict(source.options),
        username=source.username,
        password=source.password,
        timeouts=timeouts,
    )


def without_points(source: PlanSource) -> PlanSource:
    """去掉点位的副本。

    ⚠ 判「要不要重连」只看它：只加了一个点位就把整台设备的会话断一次，是每次
    保存配置都要停采几秒的做法。
    Args: source。
    """
    return source.model_copy(update={"points": ()})
