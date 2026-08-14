"""源行 → 判定帧的用例 —— 掩码与达标口径都在这一层定死。

守的是「哪一分钟能用来判定」：清零、尖峰与 NULL 若被当成正常读数，抽取引擎
会照单全收地产出一批看起来完全合理的假样本。
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from platform_server.apps.hvac.services.ac_source_reader import SourceRow
from platform_server.apps.hvac.services.ac_startup_frames import (
    METRIC_FAN_FREQUENCY,
    METRIC_WORKSHOP_HUMIDITY,
    METRIC_WORKSHOP_TEMP,
    MetricBand,
    RoomUnit,
    build_frames,
)
from platform_server.apps.hvac.services.ac_startup_rules import (
    ExtractionRules,
    extract_episodes,
)

BASE = datetime(2026, 3, 1, 0, 0, tzinfo=UTC)
TEMP_BAND = MetricBand(lower=Decimal("22.00"), upper=Decimal("26.00"))
HUMIDITY_BAND = MetricBand(lower=Decimal("50.00"), upper=Decimal("60.00"))
BANDS = {
    METRIC_WORKSHOP_TEMP: TEMP_BAND,
    METRIC_WORKSHOP_HUMIDITY: HUMIDITY_BAND,
}
K11 = RoomUnit(serial="K11", bands=BANDS)
K12 = RoomUnit(serial="K12", bands=BANDS)


def at(minute: int) -> datetime:
    """基准时刻起的第 n 分钟。

    Args: minute。
    """
    return BASE + timedelta(minutes=minute)


def row(
    minute: int,
    *,
    celsius: object = 24.0,
    humidity: object = 55.0,
    frequency: object = 40.0,
) -> SourceRow:
    """造一行源数据。三个判定指标可以各自换成 None 或异常值。

    Args: minute, celsius, humidity, frequency。
    """
    return SourceRow(
        ts=at(minute),
        values={
            METRIC_WORKSHOP_TEMP: celsius,
            METRIC_WORKSHOP_HUMIDITY: humidity,
            METRIC_FAN_FREQUENCY: frequency,
            "supply_air_temp": 18.0,
        },
    )


def test_a_frame_is_valid_only_when_every_unit_reported() -> None:
    """少一台就判不了这一分钟的房间状态，整帧作废。"""
    frames = build_frames([K11, K12], {"K11": [row(0)], "K12": []})
    assert len(frames) == 1
    assert frames[0].is_valid is False
    assert frames[0].is_compliant is False


def test_a_zeroed_workshop_temperature_makes_the_frame_invalid() -> None:
    """整行清零是采集缺陷，不是「没开机」。"""
    frames = build_frames([K11], {"K11": [row(0, celsius=0.0, frequency=0.0)]})
    assert frames[0].is_valid is False


@pytest.mark.parametrize("celsius", [273305.0, -30.0], ids=["huge", "below"])
def test_a_temperature_spike_makes_the_frame_invalid(celsius: float) -> None:
    """超出 −20..60 ℃ 的读数是尖峰，那一帧不参与判定。"""
    frames = build_frames([K11], {"K11": [row(0, celsius=celsius)]})
    assert frames[0].is_valid is False


@pytest.mark.parametrize(
    "celsius", [-20.0, 60.0], ids=["at-the-floor", "at-the-ceiling"]
)
def test_the_plausible_temperature_range_is_inclusive(celsius: float) -> None:
    """合理区间的两端本身算合理。"""
    frames = build_frames([K11], {"K11": [row(0, celsius=celsius)]})
    assert frames[0].is_valid is True


def test_a_null_fan_frequency_is_not_a_stopped_unit() -> None:
    """⚠ 频率为 NULL 不等于 0：折成 0 会把一次断档读成停机加开机。"""
    frames = build_frames([K11], {"K11": [row(0, frequency=None)]})
    assert frames[0].is_valid is False
    assert frames[0].running == frozenset()


@pytest.mark.parametrize(
    "kwargs",
    [{"humidity": None}, {"celsius": None}],
    ids=["humidity", "temperature"],
)
def test_a_missing_decision_metric_makes_the_frame_invalid(
    kwargs: dict[str, object],
) -> None:
    """判达标的两个量缺一个，这一分钟就判不了达标。"""
    frames = build_frames([K11], {"K11": [row(0, **kwargs)]})
    assert frames[0].is_valid is False


def test_a_non_numeric_source_value_counts_as_missing() -> None:
    """外库回来的非数一律当缺测，不试图解析。"""
    frames = build_frames([K11], {"K11": [row(0, frequency="40")]})
    assert frames[0].is_valid is False


def test_running_carries_the_units_with_a_positive_fan_frequency() -> None:
    """运行 = 这一分钟频率大于 0 的那几台。"""
    frames = build_frames(
        [K11, K12], {"K11": [row(0)], "K12": [row(0, frequency=0.0)]}
    )
    assert frames[0].running == frozenset({"K11"})


def test_compliance_requires_every_unit_inside_its_own_band() -> None:
    """房间达标要求每一台都各自落在它自己配的范围里。"""
    frames = build_frames(
        [K11, K12], {"K11": [row(0)], "K12": [row(0, celsius=27.0)]}
    )
    assert frames[0].is_valid is True
    assert frames[0].is_compliant is False


@pytest.mark.parametrize(
    "celsius", [22.0, 26.0], ids=["at-the-lower", "at-the-upper"]
)
def test_the_band_bounds_are_inclusive(celsius: float) -> None:
    """上下限是闭区间：正好落在边界上算达标。"""
    frames = build_frames([K11], {"K11": [row(0, celsius=celsius)]})
    assert frames[0].is_compliant is True


def test_a_missing_bound_does_not_constrain_that_side() -> None:
    """⚠ 单边为空表示该侧不限制，不表示 0。"""
    unit = RoomUnit(
        serial="K11",
        bands={METRIC_WORKSHOP_TEMP: MetricBand(lower=None, upper=None)},
    )
    frames = build_frames([unit], {"K11": [row(0, celsius=-19.0)]})
    assert frames[0].is_compliant is True


def test_a_unit_without_any_band_is_trivially_compliant() -> None:
    """没配达标范围的空调不拖着房间不达标。"""
    unit = RoomUnit(serial="K11", bands={})
    frames = build_frames([unit], {"K11": [row(0, celsius=45.0)]})
    assert frames[0].is_compliant is True


def test_an_invalid_frame_is_never_compliant() -> None:
    """读数不可信时不许宣布达标，哪怕数字正好落在范围内。"""
    frames = build_frames(
        [K11, K12], {"K11": [row(0)], "K12": [row(0, frequency=None)]}
    )
    assert frames[0].is_valid is False
    assert frames[0].is_compliant is False


def test_readings_carry_the_raw_values_including_nulls() -> None:
    """读数原样带着，含 None——事件表存的就是它。"""
    frames = build_frames([K11], {"K11": [row(0, humidity=None)]})
    assert frames[0].readings == {
        "K11": {
            METRIC_WORKSHOP_TEMP: 24.0,
            METRIC_WORKSHOP_HUMIDITY: None,
            METRIC_FAN_FREQUENCY: 40.0,
            "supply_air_temp": 18.0,
        }
    }


def test_frames_come_out_ordered_by_time() -> None:
    """两台的行各自乱序进来，帧序列仍按时刻升序。"""
    frames = build_frames(
        [K11, K12],
        {"K11": [row(2), row(0)], "K12": [row(1), row(2), row(0)]},
    )
    assert [item.ts for item in frames] == [at(0), at(1), at(2)]
    # 第 1 分钟只有 K12 有行，判不了房间
    assert [item.is_valid for item in frames] == [True, False, True]


def test_a_unit_with_no_rows_leaves_every_frame_invalid() -> None:
    """一台整段没有数据，这一段就一分钟都判不了。"""
    frames = build_frames([K11, K12], {"K11": [row(0), row(1)]})
    assert [item.is_valid for item in frames] == [False, False]


def test_no_rows_at_all_yields_no_frames() -> None:
    """没有源行就没有帧。"""
    assert build_frames([K11], {}) == []


def zeroing_rows() -> list[SourceRow]:
    """一段带整行清零缺陷的源行：全停 30 分钟后开机，第 40 分钟被清零。"""
    rows = [row(minute, celsius=28.0, frequency=0.0) for minute in range(30)]
    rows.extend(row(minute, celsius=27.0) for minute in range(30, 40))
    # 采集缺陷：这一分钟的频率与车间温度一起归零，下一分钟自行恢复
    rows.append(row(40, celsius=0.0, frequency=0.0))
    rows.extend(row(minute, celsius=27.0) for minute in range(41, 50))
    rows.extend(row(minute) for minute in range(50, 71))
    return rows


def test_a_zeroed_minute_does_not_split_one_startup_into_two() -> None:
    """⚠ 掩掉清零行之后，一次开机不会被切成一次停机加一次开机。

    这是掩码真正的用处，也是全史里覆盖机组分钟数最多的那一条：不掩掉
    `workshop_temp_avg = 0` 的行，按 `fan_frequency > 0` 就会凭空造出开停机对。
    """
    frames = build_frames([K11], {"K11": zeroing_rows()})
    episodes = extract_episodes(frames, rules=ExtractionRules())
    assert len(episodes) == 1
    assert episodes[0].started_at == at(30)
    assert episodes[0].complied_at == at(50)
    assert episodes[0].duration_minutes == 20
    assert episodes[0].outcome == "usable"
