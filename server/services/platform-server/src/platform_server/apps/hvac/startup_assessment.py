"""冷启动能否评估取决于开机时所用季节的有效上下限。"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from platform_server.apps.hvac.rooms import MetricBand, RoomUnit
from platform_server.apps.hvac.seasons import WinterPeriod


def has_limits(bands: Mapping[str, MetricBand]) -> bool:
    """至少有一个有效上下限才有达标条件。Args: bands。"""
    return any(
        band.lower is not None or band.upper is not None
        for band in bands.values()
    )


@dataclass(frozen=True)
class ColdStartAssessment:
    """冻结配置下，一年中哪些业务日期至少有一个机组达标范围。"""

    timezone: str
    is_always_assessable: bool = False
    winter_only: tuple[WinterPeriod, ...] = ()
    non_winter_only: tuple[WinterPeriod, ...] = ()

    def allows(self, started_at: datetime) -> bool:
        """开机时刻是否有有效达标条件。Args: started_at。"""
        return (
            self.is_always_assessable
            or any(
                period.contains(started_at, self.timezone)
                for period in self.winter_only
            )
            or any(
                not period.contains(started_at, self.timezone)
                for period in self.non_winter_only
            )
        )


def cold_start_assessment(
    units: Sequence[RoomUnit], timezone: str
) -> ColdStartAssessment:
    """从冻结的带数据源机组恢复季节评估范围。Args: units, timezone。"""
    winter: list[WinterPeriod] = []
    non_winter: list[WinterPeriod] = []
    for unit in units:
        period = unit.winter_period
        has_non_winter = has_limits(unit.bands)
        has_winter = has_limits(unit.winter_bands)
        if has_non_winter and (period is None or has_winter):
            return ColdStartAssessment(timezone, is_always_assessable=True)
        if period is None:
            continue
        if has_winter:
            winter.append(period)
        if has_non_winter:
            non_winter.append(period)
    return ColdStartAssessment(
        timezone, winter_only=tuple(winter), non_winter_only=tuple(non_winter)
    )
