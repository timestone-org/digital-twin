"""训练前样本甄别的用例 —— 标签与达标范围对不上的事件进不了拟合。

⚠ 两个方向的代价不对称：多剔一条只是少个样本；少剔一条是让模型去学一份现在
已经不成立的物理，而且训练全程一声不吭。
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from platform_server.apps.hvac.modeling.curation import (
    curate,
    is_instantly_compliant,
)
from platform_server.apps.hvac.modeling.features import (
    EpisodeSample,
    StartConditions,
)
from platform_server.apps.hvac.modeling.training import (
    MIN_SAMPLES,
    InsufficientSamples,
    train,
)
from platform_server.apps.hvac.rooms import (
    METRIC_WORKSHOP_HUMIDITY,
    METRIC_WORKSHOP_TEMP,
    MetricBand,
    RoomUnit,
)

BASE = datetime(2026, 3, 1, tzinfo=UTC)
TZ = "Asia/Shanghai"
_TEMPERATURE_BAND = MetricBand(lower=Decimal(18), upper=Decimal(26))
_HUMIDITY_BAND = MetricBand(lower=None, upper=Decimal(60))

# K01 温湿度都有范围，K02 只有温度——「没配范围的指标不限制」也要钉住
UNITS = (
    RoomUnit(
        serial="K01",
        bands={
            METRIC_WORKSHOP_TEMP: _TEMPERATURE_BAND,
            METRIC_WORKSHOP_HUMIDITY: _HUMIDITY_BAND,
        },
    ),
    RoomUnit(serial="K02", bands={METRIC_WORKSHOP_TEMP: _TEMPERATURE_BAND}),
)


def episode(
    *,
    temperature: float,
    minutes: int,
    humidity: float | None = 50.0,
    index: int = 0,
) -> EpisodeSample:
    """一条事件：两台读同一份温湿度，起始时刻按 index 往后排。

    Args: temperature, minutes, humidity, index。
    """
    values: dict[str, float | None] = {
        METRIC_WORKSHOP_TEMP: temperature,
        METRIC_WORKSHOP_HUMIDITY: humidity,
    }
    return EpisodeSample(
        conditions=StartConditions(
            started_at=BASE + timedelta(hours=index),
            running_set=("K01",),
            idle_minutes=120,
            readings={"K01": dict(values), "K02": dict(values)},
        ),
        duration_minutes=minutes,
    )


def test_an_in_band_start_that_claims_a_duration_is_dropped() -> None:
    """开机那一刻就已达标，却记着 12 分钟——两者只能有一个是真的。"""
    found = curate([episode(temperature=24.0, minutes=12)], units=UNITS)
    assert found.kept == ()
    assert found.contradictory_count == 1


def test_an_in_band_start_with_zero_duration_stays() -> None:
    """开机即达标、时长 0：这正是现网近半样本的样子，一条都不能少。"""
    found = curate([episode(temperature=24.0, minutes=0)], units=UNITS)
    assert len(found.kept) == 1
    assert found.contradictory_count == 0


def test_an_out_of_band_start_keeps_its_duration() -> None:
    """带外开机记着时长，是这个模型要学的主线，不许碰。"""
    found = curate([episode(temperature=29.0, minutes=20)], units=UNITS)
    assert len(found.kept) == 1


def test_an_out_of_band_start_with_zero_duration_is_counted_not_dropped() -> (
    None
):
    """⚠ 反方向同样是标签过期的证据，但剔它会在达标范围收窄后删掉整批零样本
    ——那是「批次该重抽」的信号，不该由训练替人做决定，只数出来。"""
    found = curate([episode(temperature=29.0, minutes=0)], units=UNITS)
    assert len(found.kept) == 1
    assert found.contradictory_count == 0
    assert found.unexplained_zero_count == 1


def test_only_one_metric_out_of_band_is_enough_to_be_uncompliant() -> None:
    """达标要每一项都在带内：温度合格、湿度超限就不算达标。"""
    assert not is_instantly_compliant(
        episode(temperature=24.0, minutes=0, humidity=70.0), UNITS
    )


def test_a_missing_reading_is_not_read_as_compliant() -> None:
    """⚠ 缺测不是达标：读不到湿度就不能替它作证，那条 12 分钟得留着。"""
    sample = episode(temperature=24.0, minutes=12, humidity=None)
    assert not is_instantly_compliant(sample, UNITS)
    assert len(curate([sample], units=UNITS).kept) == 1


def test_a_unit_absent_from_the_readings_is_not_read_as_compliant() -> None:
    """⚠ 机组绑定在抽取之后加过时，起始帧上没有它的读数——只许少判达标。"""
    extra = RoomUnit(
        serial="K09", bands={METRIC_WORKSHOP_TEMP: _TEMPERATURE_BAND}
    )
    sample = episode(temperature=24.0, minutes=12)
    assert not is_instantly_compliant(sample, (*UNITS, extra))


def test_a_unit_without_any_band_never_blocks_compliance() -> None:
    """没配范围 = 该台不限制，与抽取引擎同口径。"""
    free = RoomUnit(serial="K03", bands={})
    sample = episode(temperature=24.0, minutes=0)
    sample.conditions.readings["K03"] = {}
    assert is_instantly_compliant(sample, (*UNITS, free))


def test_an_empty_unit_list_never_reports_compliant() -> None:
    """⚠ `all()` 在空序列上恒真：照搬就会把非零时长的样本全剔光。"""
    assert not is_instantly_compliant(episode(temperature=24.0, minutes=12), ())


def test_the_count_says_how_many_were_dropped() -> None:
    """剔了几条要数得准——那个数是操作员判断「该不该重抽」的唯一依据。"""
    rows = [
        episode(temperature=24.0, minutes=at % 3, index=at) for at in range(9)
    ]
    found = curate(rows, units=UNITS)
    assert found.contradictory_count == 6
    assert found.unexplained_zero_count == 0
    assert len(found.kept) == 3


def test_a_fresh_batch_shows_zero_on_both_counters() -> None:
    """标签与达标范围一致时两个数都是 0——它们不为零就是「该重抽」的信号。"""
    rows = [
        episode(temperature=24.0, minutes=0, index=0),
        episode(temperature=29.0, minutes=20, index=1),
    ]
    found = curate(rows, units=UNITS)
    assert found.contradictory_count == 0
    assert found.unexplained_zero_count == 0
    assert len(found.kept) == 2


def test_the_sample_floor_counts_only_what_survives_curation() -> None:
    """⚠ 下限按剔除之后的条数算：先拿毛数放行，就是用过期标签训出一个模型。"""
    rows = [
        episode(temperature=29.0, minutes=12, index=at)
        for at in range(MIN_SAMPLES)
    ]
    rows[0] = episode(temperature=24.0, minutes=12, index=0)
    with pytest.raises(InsufficientSamples, match=str(MIN_SAMPLES - 1)):
        train(rows, units=UNITS, timezone=TZ, half_life_days=180.0)
