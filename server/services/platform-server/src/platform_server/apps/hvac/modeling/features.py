"""开机事件 → 特征向量 —— 训练与试算共用的唯一实现。

训练与在线试算必须走同一条路径，否则两边各算一份就是训练/服务偏差。
特征口径见 docs/AC_MODEL_DESIGN.md §2.4。
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from platform_server.apps.hvac.services.ac_startup_frames import (
    METRIC_WORKSHOP_HUMIDITY,
    METRIC_WORKSHOP_TEMP,
    RoomUnit,
)

# ⚠ 改特征算法的人手动 +1，纪律同 LOGIC_VERSION：模型上存着训练时的取值，
# 页面据此提示「特征口径已更新，建议重训」。
# v2：加设定值距离、回风/送风、温湿度极差、焓值与空气路径温差（热力学口径
# 取自参考实现 ../Baoding/api 的特征工程，只取按物理讲得通的那部分）
FEATURE_VERSION = 2

# 外部条件与供冷能力的代理测点（datasets.py 里的列名）
_FRESH_TEMP = "fresh_air_temp"
_FRESH_HUMIDITY = "fresh_air_humidity"
_CHILLED_TEMP = "chilled_water_supply_temp"
_RETURN_TEMP = "return_air_temp"
_RETURN_HUMIDITY = "return_air_humidity"
_SUPPLY_TEMP = "supply_air_temp"
_SETPOINT_TEMP = "ac_temp_setpoint"
_SETPOINT_HUMIDITY = "ac_humidity_setpoint"

# 工作时段的本地小时界（左闭右开）
_WORK_START_HOUR = 8
_WORK_END_HOUR = 18

Readings = Mapping[str, Mapping[str, float | None]]


@dataclass(frozen=True)
class StartConditions:
    """一次开机（真实的或试算假想的）的起始条件。"""

    started_at: datetime
    running_set: tuple[str, ...]
    idle_minutes: int | None
    readings: Readings


@dataclass(frozen=True)
class EpisodeSample:
    """训练用的一条可用事件：起始条件 + 答案，与 ORM 解耦。"""

    conditions: StartConditions
    duration_minutes: int


def feature_names(units: Sequence[RoomUnit]) -> tuple[str, ...]:
    """特征列名，顺序即矩阵列序；组合指示列随房间机组数变。

    Args: units（serial 升序）。
    """
    return (
        "mean_temp",
        "mean_humidity",
        "worst_temp_over",
        "worst_humidity_over",
        "temp_margin",
        "humidity_margin",
        *(f"run_{unit.serial}" for unit in units),
        "running_count",
        "idle_minutes",
        "hour_sin",
        "hour_cos",
        "is_work_hours",
        "month_sin",
        "month_cos",
        "fresh_air_temp",
        "fresh_air_humidity",
        "chilled_water_temp",
        "setpoint_temp_gap",
        "setpoint_humidity_gap",
        "return_air_temp",
        "return_air_humidity",
        "supply_air_temp",
        "temp_spread",
        "humidity_spread",
        "workshop_enthalpy",
        "enthalpy_setpoint_gap",
        "fresh_return_temp_gap",
        "supply_return_temp_gap",
    )


def build_row(
    conditions: StartConditions,
    *,
    units: Sequence[RoomUnit],
    timezone: str,
) -> list[float]:
    """一次起始条件的特征行。缺测一律 NaN，不插值不填充。

    Args: conditions, units, timezone。
    """
    readings = conditions.readings
    running = frozenset(conditions.running_set)
    idle = conditions.idle_minutes
    return [
        _mean(_values(readings, units, METRIC_WORKSHOP_TEMP)),
        _mean(_values(readings, units, METRIC_WORKSHOP_HUMIDITY)),
        _worst_over(readings, units, METRIC_WORKSHOP_TEMP),
        _worst_over(readings, units, METRIC_WORKSHOP_HUMIDITY),
        _worst_margin(readings, units, METRIC_WORKSHOP_TEMP),
        _worst_margin(readings, units, METRIC_WORKSHOP_HUMIDITY),
        *(1.0 if unit.serial in running else 0.0 for unit in units),
        float(len(running)),
        float(idle) if idle is not None else math.nan,
        *_clock(conditions.started_at, timezone),
        _mean(_running_values(readings, running, _FRESH_TEMP)),
        _mean(_running_values(readings, running, _FRESH_HUMIDITY)),
        _mean(_running_values(readings, running, _CHILLED_TEMP)),
        _setpoint_gap(readings, units, METRIC_WORKSHOP_TEMP, _SETPOINT_TEMP),
        _setpoint_gap(
            readings, units, METRIC_WORKSHOP_HUMIDITY, _SETPOINT_HUMIDITY
        ),
        _mean(_running_values(readings, running, _RETURN_TEMP)),
        _mean(_running_values(readings, running, _RETURN_HUMIDITY)),
        _mean(_running_values(readings, running, _SUPPLY_TEMP)),
        _spread(_values(readings, units, METRIC_WORKSHOP_TEMP)),
        _spread(_values(readings, units, METRIC_WORKSHOP_HUMIDITY)),
        _mean(_enthalpies(readings, units)),
        _mean(_enthalpy_gaps(readings, units)),
        _mean(_pair_gaps(readings, running, _FRESH_TEMP, _RETURN_TEMP)),
        _mean(_pair_gaps(readings, running, _SUPPLY_TEMP, _RETURN_TEMP)),
    ]


def build_matrix(
    samples: Sequence[EpisodeSample],
    *,
    units: Sequence[RoomUnit],
    timezone: str,
) -> list[list[float]]:
    """一批事件的特征矩阵，行序与入参一致。

    Args: samples, units, timezone。
    """
    return [
        build_row(sample.conditions, units=units, timezone=timezone)
        for sample in samples
    ]


def _values(
    readings: Readings, units: Sequence[RoomUnit], metric: str
) -> list[float]:
    """全部机组在某个指标上的有效读数（房间初始条件按全房间算）。

    Args: readings, units, metric。
    """
    found = [readings.get(unit.serial, {}).get(metric) for unit in units]
    return [value for value in found if value is not None]


def _running_values(
    readings: Readings, running: frozenset[str], metric: str
) -> list[float]:
    """运行机组在某个指标上的有效读数（外部条件只看在跑的那几台）。

    Args: readings, running, metric。
    """
    found = [readings.get(serial, {}).get(metric) for serial in running]
    return [value for value in found if value is not None]


def _mean(values: Sequence[float]) -> float:
    """均值；没有一台有读数就是 NaN。

    Args: values。
    """
    if not values:
        return math.nan
    return sum(values) / len(values)


def _edges(unit: RoomUnit, metric: str, value: float) -> list[float]:
    """一台机组在某个指标上「距各配置边界」的带符号距离（正 = 超限）。

    Args: unit, metric, value。
    """
    band = unit.bands.get(metric)
    if band is None:
        return []
    found: list[float] = []
    if band.lower is not None:
        found.append(float(band.lower) - value)
    if band.upper is not None:
        found.append(value - float(band.upper))
    return found


def _worst_over(
    readings: Readings, units: Sequence[RoomUnit], metric: str
) -> float:
    """最不利那台的超限量：max(下界−值, 值−上界, 0) 的全房间最大值。

    ⚠ 达标由最不利那台决定（AC_STARTUP_DESIGN §3.5），只给均值的话模型
    看不见真正卡住达标的那个量。
    Args: readings, units, metric。
    """
    found = [
        max([*edges, 0.0])
        for unit in units
        if (value := readings.get(unit.serial, {}).get(metric)) is not None
        and (edges := _edges(unit, metric, value))
    ]
    if not found:
        return math.nan
    return max(found)


def _worst_margin(
    readings: Readings, units: Sequence[RoomUnit], metric: str
) -> float:
    """房间级带内余量：负 = 已在带内的富余，正 = 距带边的欠账。

    Args: readings, units, metric。
    """
    found = [
        max(edges)
        for unit in units
        if (value := readings.get(unit.serial, {}).get(metric)) is not None
        and (edges := _edges(unit, metric, value))
    ]
    if not found:
        return math.nan
    return max(found)


def _setpoint_gap(
    readings: Readings,
    units: Sequence[RoomUnit],
    metric: str,
    setpoint: str,
) -> float:
    """当前值距设定值的平均差（正 = 高于设定值）。

    控制器追的是设定值不是达标带：距设定值越远，机组要做的功越多。
    Args: readings, units, metric, setpoint。
    """
    found: list[float] = []
    for unit in units:
        values = readings.get(unit.serial, {})
        current = values.get(metric)
        target = values.get(setpoint)
        if current is not None and target is not None:
            found.append(current - target)
    return _mean(found)


def _spread(values: Sequence[float]) -> float:
    """全房间读数的极差：梯度大说明气流没混匀，达标要等最慢的角落。

    Args: values。
    """
    if not values:
        return math.nan
    return max(values) - min(values)


def _enthalpy(temp_c: float, humidity_pct: float) -> float:
    """湿空气比焓（kJ/kg 干空气），温湿度合一的真实热负荷量。

    Buck 饱和压 + ASHRAE 常数，口径与参考实现 ../Baoding/api 一致。
    Args: temp_c, humidity_pct。
    """
    if temp_c >= 0:
        saturation = 610.78 * math.exp(17.27 * temp_c / (temp_c + 237.3))
    else:
        saturation = 610.78 * math.exp(21.88 * temp_c / (temp_c + 265.5))
    vapor = humidity_pct / 100.0 * saturation
    pressure = 101325.0
    dry = max(pressure - vapor, 0.01 * pressure)
    ratio = 0.622 * vapor / dry
    return 1.006 * temp_c + ratio * (2501.0 + 1.86 * temp_c)


def _enthalpies(readings: Readings, units: Sequence[RoomUnit]) -> list[float]:
    """各台车间空气的比焓；温湿度缺一台就少一台。

    Args: readings, units。
    """
    found: list[float] = []
    for unit in units:
        values = readings.get(unit.serial, {})
        temperature = values.get(METRIC_WORKSHOP_TEMP)
        humidity = values.get(METRIC_WORKSHOP_HUMIDITY)
        if temperature is not None and humidity is not None:
            found.append(_enthalpy(temperature, humidity))
    return found


def _enthalpy_gaps(
    readings: Readings, units: Sequence[RoomUnit]
) -> list[float]:
    """各台「当前焓 − 设定焓」：比温差更接近机组真正要做的功。

    Args: readings, units。
    """
    found: list[float] = []
    for unit in units:
        values = readings.get(unit.serial, {})
        temperature = values.get(METRIC_WORKSHOP_TEMP)
        humidity = values.get(METRIC_WORKSHOP_HUMIDITY)
        target_temperature = values.get(_SETPOINT_TEMP)
        target_humidity = values.get(_SETPOINT_HUMIDITY)
        if temperature is None or humidity is None:
            continue
        if target_temperature is None or target_humidity is None:
            continue
        found.append(
            _enthalpy(temperature, humidity)
            - _enthalpy(target_temperature, target_humidity)
        )
    return found


def _pair_gaps(
    readings: Readings,
    running: frozenset[str],
    first: str,
    second: str,
) -> list[float]:
    """运行机组上两个测点的差（新风−回风=新风负荷，送风−回风=处理能力）。

    Args: readings, running, first, second。
    """
    found: list[float] = []
    for serial in running:
        values = readings.get(serial, {})
        left = values.get(first)
        right = values.get(second)
        if left is not None and right is not None:
            found.append(left - right)
    return found


def _clock(started_at: datetime, timezone: str) -> list[float]:
    """时段与季节的周期编码，按房间当地时折算。

    Args: started_at, timezone。
    """
    local = started_at.astimezone(ZoneInfo(timezone))
    hour = local.hour + local.minute / 60
    month_turn = (local.month - 1) / 12
    return [
        math.sin(2 * math.pi * hour / 24),
        math.cos(2 * math.pi * hour / 24),
        1.0 if _WORK_START_HOUR <= local.hour < _WORK_END_HOUR else 0.0,
        math.sin(2 * math.pi * month_turn),
        math.cos(2 * math.pi * month_turn),
    ]
