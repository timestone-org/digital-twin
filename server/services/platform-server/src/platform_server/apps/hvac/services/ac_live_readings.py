"""房间机组的当下读数：每台在回看窗内的最后一行。

判定口径（运行位、整行清零、温度可信区间、非数按缺测）全部复用抽取层的那份，见
`ac_startup_frames`。外库不可达时让 `SourceUnavailable` 冒出去，不返回陈旧
数据兜底（docs/adr/0006）。
"""

import uuid
from collections.abc import Mapping, Sequence
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from lib.utils.timeutils import utcnow
from platform_server.apps.hvac.datasets import (
    GROUP_TEMPERATURE,
    RAW_MINUTE_METRICS,
)
from platform_server.apps.hvac.schemas import (
    LiveReadingsOut,
    LiveReadingValuesOut,
    LiveUnitReadingOut,
    TimeWindow,
)
from platform_server.apps.hvac.services.ac_source_reader import (
    AcSourceReader,
    SourceRow,
)
from platform_server.apps.hvac.services.ac_startup_extract import (
    BoundUnit,
    load_bound_units,
)
from platform_server.apps.hvac.services.ac_startup_frames import (
    METRIC_FAN_FREQUENCY,
    METRIC_WORKSHOP_HUMIDITY,
    METRIC_WORKSHOP_TEMP,
    is_plausible_celsius,
    is_zeroed_row,
    numeric_values,
    running_state,
)
from platform_server.apps.hvac.services.room_service import require_room

# 回看窗（分钟）：外库逐分钟写入，再早的行回答不了「现在是什么状况」
LOOKBACK_MINUTES = 15
# 窗口右端往后留一点：外库那边的写入时钟可能略微超前于本服务
_LOOKAHEAD = timedelta(minutes=1)
# ⚠ 取数 SQL 是升序 TOP：行数超过它就会截在窗口前段，「最后一行」于是变旧。
# 十几分钟的窗即使按秒写也只有千行量级
_MAX_WINDOW_ROWS = 4000

_FRESH_AIR_TEMP = "fresh_air_temp"
_FRESH_AIR_HUMIDITY = "fresh_air_humidity"
_CHILLED_WATER_SUPPLY_TEMP = "chilled_water_supply_temp"

# 面板上的五个读数，与试算入参逐一对应
LIVE_METRICS = (
    METRIC_WORKSHOP_TEMP,
    METRIC_WORKSHOP_HUMIDITY,
    _FRESH_AIR_TEMP,
    _FRESH_AIR_HUMIDITY,
    _CHILLED_WATER_SUPPLY_TEMP,
)
# 运行位要看风机频率，故取数列比对外字段多一列
_COLUMNS = (*LIVE_METRICS, METRIC_FAN_FREQUENCY)
_CELSIUS_METRICS = frozenset(
    metric.key
    for metric in RAW_MINUTE_METRICS
    if metric.group == GROUP_TEMPERATURE
)


async def read_live(
    session: AsyncSession, reader: AcSourceReader, *, room_id: uuid.UUID
) -> LiveReadingsOut:
    """房间里每台绑定了原始数据的机组的当下读数，serial 升序。

    Args: session, reader, room_id。
    """
    await require_room(session, room_id)
    as_of = utcnow()
    window = TimeWindow(
        start=as_of - timedelta(minutes=LOOKBACK_MINUTES),
        end=as_of + _LOOKAHEAD,
    )
    units = await load_bound_units(session, room_id)
    return LiveReadingsOut(
        as_of=as_of,
        lookback_minutes=LOOKBACK_MINUTES,
        units=[
            await _unit_reading(reader, bound, window=window) for bound in units
        ],
    )


async def _unit_reading(
    reader: AcSourceReader, bound: BoundUnit, *, window: TimeWindow
) -> LiveUnitReadingOut:
    """一台机组在窗内的最后一条可用读数；一条都没有则全是未知。

    Args: reader, bound, window。
    """
    rows = await reader.fetch_samples(
        source_object=bound.source_object,
        columns=_COLUMNS,
        window=window,
        row_limit=_MAX_WINDOW_ROWS,
    )
    found = _last_usable(rows)
    if found is None:
        return _unknown(bound.unit.serial)
    row, values = found
    return LiveUnitReadingOut(
        serial=bound.unit.serial,
        sampled_at=row.ts,
        is_running=running_state(values),
        readings=_values_out(values),
    )


def _last_usable(
    rows: Sequence[SourceRow],
) -> tuple[SourceRow, dict[str, float | None]] | None:
    """窗内最后一条非清零行连同它的数值读数；一条都没有给 None。

    ⚠ 往回退而不是照原样报出末行：整行清零是采集缺陷，0.0℃ 会被当成一个真实
    的冷读数喂进开机决策。
    Args: rows（按时刻升序）。
    """
    for row in reversed(rows):
        values = numeric_values(row)
        if not is_zeroed_row(values):
            return row, values
    return None


def _unknown(serial: str) -> LiveUnitReadingOut:
    """窗内没有可用行的那一台：时刻、运行位与五个读数全是未知。

    Args: serial。
    """
    return LiveUnitReadingOut(
        serial=serial,
        sampled_at=None,
        is_running=None,
        readings=_values_out({}),
    )


def _values_out(values: Mapping[str, float | None]) -> LiveReadingValuesOut:
    """五个关键读数的对外形态。

    Args: values。
    """
    return LiveReadingValuesOut(
        workshop_temp_avg=_reading(values, METRIC_WORKSHOP_TEMP),
        workshop_humidity_avg=_reading(values, METRIC_WORKSHOP_HUMIDITY),
        fresh_air_temp=_reading(values, _FRESH_AIR_TEMP),
        fresh_air_humidity=_reading(values, _FRESH_AIR_HUMIDITY),
        chilled_water_supply_temp=_reading(values, _CHILLED_WATER_SUPPLY_TEMP),
    )


def _reading(values: Mapping[str, float | None], metric: str) -> float | None:
    """一个读数：缺测、或温度超出可信区间，都给 None。

    Args: values, metric。
    """
    value = values.get(metric)
    if value is None:
        return None
    if metric in _CELSIUS_METRICS and not is_plausible_celsius(value):
        return None
    return value
