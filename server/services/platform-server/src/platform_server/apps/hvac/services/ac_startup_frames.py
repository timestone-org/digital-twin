"""源行 → 判定帧：把外库的逐分钟原始行摊成房间级的帧序列。

清零、NULL 与温度尖峰的掩码都在这一层做完（docs/AC_STARTUP_DESIGN.md §2），
抽取引擎只看 `Frame` 上算好的判定位。达标口径见同文档 §3.5。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from platform_server.apps.hvac.services.ac_source_reader import SourceRow
from platform_server.apps.hvac.services.ac_startup_rules import (
    Frame,
    Readings,
)

METRIC_FAN_FREQUENCY = "fan_frequency"
METRIC_WORKSHOP_TEMP = "workshop_temp_avg"
METRIC_WORKSHOP_HUMIDITY = "workshop_humidity_avg"

# 三个决定判定的指标：一个定运行、两个定达标。它们缺一帧就废一帧，其余 16 个
# 指标只是随事件一起留档，缺了不影响判定
DECISION_METRICS = (
    METRIC_FAN_FREQUENCY,
    METRIC_WORKSHOP_TEMP,
    METRIC_WORKSHOP_HUMIDITY,
)

# 车间温度的合理区间，超出即判为尖峰（实测有 273305 这类值）
MIN_PLAUSIBLE_CELSIUS = -20.0
MAX_PLAUSIBLE_CELSIUS = 60.0


@dataclass(frozen=True)
class MetricBand:
    """一个指标的达标范围。⚠ 单边为 None 表示该侧不限制，不表示 0。"""

    lower: Decimal | None
    upper: Decimal | None

    def contains(self, value: float) -> bool:
        """值是否落在闭区间内。

        Args: value。
        """
        if self.lower is not None and value < float(self.lower):
            return False
        return self.upper is None or value <= float(self.upper)


@dataclass(frozen=True)
class RoomUnit:
    """房间里的一台空调：序号，加上它自己那几条达标范围。

    ⚠ 达标要求**每一台**各自落在**它自己**配置的范围内；没配范围的指标视为
    该指标不限制。
    """

    serial: str
    bands: Mapping[str, MetricBand]


def build_frames(
    units: Sequence[RoomUnit], rows: Mapping[str, Sequence[SourceRow]]
) -> list[Frame]:
    """按时刻对齐每台空调的行，摊成房间级的帧序列。

    ⚠ 只有全部空调在这一分钟都有行时才可能出有效帧：少一台就判不了这一分钟的
    房间状态，而按「没行就是没开」处理会凭空造出开停机对。
    Args: units, rows（serial → 该台按时刻升序的源行）。
    """
    by_serial = {
        unit.serial: {
            row.ts: numeric_values(row) for row in rows.get(unit.serial, ())
        }
        for unit in units
    }
    moments = sorted({ts for found in by_serial.values() for ts in found})
    return [_to_frame(units, ts, _at(by_serial, ts)) for ts in moments]


def _at(
    by_serial: Mapping[str, Mapping[datetime, dict[str, float | None]]],
    ts: datetime,
) -> Readings:
    """取一个时刻上各台的读数；这一分钟没行的台不出现在结果里。

    Args: by_serial, ts。
    """
    return {
        serial: found[ts] for serial, found in by_serial.items() if ts in found
    }


def numeric_values(row: SourceRow) -> dict[str, float | None]:
    """把一行源值收敛成「指标 → 数」。非数一律当作缺测。

    Args: row。
    """
    return {
        name: float(value) if isinstance(value, int | float) else None
        for name, value in row.values.items()
    }


def _to_frame(
    units: Sequence[RoomUnit], ts: datetime, readings: Readings
) -> Frame:
    """一个时刻上的房间帧。

    Args: units, ts, readings。
    """
    is_valid = len(readings) == len(units) and all(
        _is_usable(readings[unit.serial]) for unit in units
    )
    return Frame(
        ts=ts,
        running=frozenset(
            serial
            for serial, values in readings.items()
            # 频率缺测（未知）在帧上按未运行处理；那一帧另有 is_valid 拦着
            if running_state(values) is True
        ),
        is_valid=is_valid,
        is_compliant=is_valid
        and all(_is_in_band(unit, readings[unit.serial]) for unit in units),
        readings=readings,
    )


def _is_usable(values: Mapping[str, float | None]) -> bool:
    """这台在这一分钟的读数可不可信。

    Args: values。
    """
    celsius = values.get(METRIC_WORKSHOP_TEMP)
    if celsius is None or is_zeroed_row(values):
        return False
    if any(values.get(metric) is None for metric in DECISION_METRICS):
        return False
    return is_plausible_celsius(celsius)


def is_zeroed_row(values: Mapping[str, float | None]) -> bool:
    """这一行是不是采集的整行清零缺陷。

    ⚠ `workshop_temp_avg == 0` 不是「没开机」，是一行假读数：按
    `fan_frequency > 0` 朴素判定会凭空造出开停机对。
    Args: values。
    """
    return values.get(METRIC_WORKSHOP_TEMP) == 0


def is_plausible_celsius(value: float) -> bool:
    """摄氏读数在不在可信区间内（实测有 273305 这类尖峰）。

    Args: value。
    """
    return MIN_PLAUSIBLE_CELSIUS <= value <= MAX_PLAUSIBLE_CELSIUS


def running_state(values: Mapping[str, float | None]) -> bool | None:
    """这台在这一刻的运行位；⚠ 频率为 NULL 是「不知道」，不是停机。

    Args: values。
    """
    frequency = values.get(METRIC_FAN_FREQUENCY)
    return None if frequency is None else frequency > 0


def _is_in_band(unit: RoomUnit, values: Mapping[str, float | None]) -> bool:
    """这台的温湿度是不是都落在它自己配置的范围内。

    Args: unit, values。
    """
    for metric, band in unit.bands.items():
        value = values.get(metric)
        if value is None or not band.contains(value):
            return False
    return True
