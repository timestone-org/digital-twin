"""达标口径的两份实现必须逐格一致 —— 抽取给标签，甄别据它剔样本。

⚠ 判定引擎那份（`services/ac_startup_frames._is_in_band`）被
`check_logic_version` 锁着：动它一个字，全仓已有批次就要判为过期、重跑一次
全量抽取。训练侧的 `RoomUnit.is_in_band` 因此只能是它的第二份实现，两份一旦
漂移，表现是训练把一批标签正确的事件当成「自相矛盾」剔掉，全程零报错。
"""

from decimal import Decimal

import pytest

from platform_server.apps.hvac.rooms import (
    METRIC_WORKSHOP_HUMIDITY,
    METRIC_WORKSHOP_TEMP,
    MetricBand,
    RoomUnit,
)
from platform_server.apps.hvac.services.ac_startup_frames import _is_in_band

_TEMPERATURE = MetricBand(lower=Decimal(18), upper=Decimal(26))
_HUMIDITY = MetricBand(lower=None, upper=Decimal(60))
_OPEN = MetricBand(lower=None, upper=None)

# 覆盖：带内、上下越界、贴着两侧边界、缺测、缺整个指标、没配范围、单边范围
CASES: tuple[dict[str, float | None], ...] = (
    {METRIC_WORKSHOP_TEMP: 24.0, METRIC_WORKSHOP_HUMIDITY: 50.0},
    {METRIC_WORKSHOP_TEMP: 26.0, METRIC_WORKSHOP_HUMIDITY: 60.0},
    {METRIC_WORKSHOP_TEMP: 18.0, METRIC_WORKSHOP_HUMIDITY: 0.0},
    {METRIC_WORKSHOP_TEMP: 26.1, METRIC_WORKSHOP_HUMIDITY: 50.0},
    {METRIC_WORKSHOP_TEMP: 17.9, METRIC_WORKSHOP_HUMIDITY: 50.0},
    {METRIC_WORKSHOP_TEMP: 24.0, METRIC_WORKSHOP_HUMIDITY: 60.1},
    {METRIC_WORKSHOP_TEMP: None, METRIC_WORKSHOP_HUMIDITY: 50.0},
    {METRIC_WORKSHOP_TEMP: 24.0, METRIC_WORKSHOP_HUMIDITY: None},
    {METRIC_WORKSHOP_TEMP: 24.0},
    {},
)

UNITS = (
    RoomUnit(
        serial="K01",
        bands={
            METRIC_WORKSHOP_TEMP: _TEMPERATURE,
            METRIC_WORKSHOP_HUMIDITY: _HUMIDITY,
        },
    ),
    RoomUnit(serial="K02", bands={METRIC_WORKSHOP_TEMP: _TEMPERATURE}),
    RoomUnit(serial="K03", bands={}),
    RoomUnit(serial="K04", bands={METRIC_WORKSHOP_TEMP: _OPEN}),
)


@pytest.mark.parametrize("unit", UNITS, ids=lambda item: item.serial)
@pytest.mark.parametrize("values", CASES, ids=range(len(CASES)))
def test_both_implementations_answer_the_same(
    unit: RoomUnit, values: dict[str, float | None]
) -> None:
    assert unit.is_in_band(values) == _is_in_band(unit, values)
