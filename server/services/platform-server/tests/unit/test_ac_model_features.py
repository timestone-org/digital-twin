"""特征构建的用例 —— 训练与试算共用的那条路径，逐列钉死。

特征算错不报错，只会让模型学到错的物理；NaN 的语义（缺测≠零）在这里锁死。
"""

import math
from datetime import UTC, datetime
from decimal import Decimal

from platform_server.apps.hvac.modeling.features import (
    EpisodeSample,
    StartConditions,
    build_matrix,
    build_row,
    feature_names,
)
from platform_server.apps.hvac.rooms import (
    MetricBand,
    RoomUnit,
)

# 2026-06-15 04:00 UTC = 当地（Asia/Shanghai）12:00，工作时段正中
NOON_UTC = datetime(2026, 6, 15, 4, 0, tzinfo=UTC)
TZ = "Asia/Shanghai"


def unit(serial: str, *, upper: float | None = 26.0) -> RoomUnit:
    """一台带温度上限（可选）与湿度上限 60 的机组。

    Args: serial, upper。
    """
    bands: dict[str, MetricBand] = {
        "workshop_humidity_avg": MetricBand(lower=None, upper=Decimal(60))
    }
    if upper is not None:
        bands["workshop_temp_avg"] = MetricBand(
            lower=Decimal(18), upper=Decimal(str(upper))
        )
    return RoomUnit(serial=serial, bands=bands)


UNITS = (unit("K11"), unit("K12"))


def conditions(
    readings: dict[str, dict[str, float | None]],
    *,
    running: tuple[str, ...] = ("K11",),
    idle: int | None = 120,
) -> StartConditions:
    """一份起始条件。

    Args: readings, running, idle。
    """
    return StartConditions(
        started_at=NOON_UTC,
        running_set=running,
        idle_minutes=idle,
        readings=readings,
    )


def by_name(row: list[float]) -> dict[str, float]:
    """列名 → 值，断言不必数下标。

    Args: row。
    """
    return dict(zip(feature_names(UNITS), row, strict=True))


def test_feature_names_scale_with_the_room() -> None:
    """组合指示列随房间机组数变，其余列固定。"""
    names = feature_names(UNITS)
    assert names.index("run_K11") < names.index("run_K12")
    assert len(names) == 6 + len(UNITS) + 1 + 1 + 5 + 3 + 7 + 4


def test_room_conditions_average_over_all_units() -> None:
    """初始条件按全房间算：探头都在房间里，与谁在运行无关。"""
    row = by_name(
        build_row(
            conditions(
                {
                    "K11": {"workshop_temp_avg": 30.0},
                    "K12": {"workshop_temp_avg": 28.0},
                }
            ),
            units=UNITS,
            timezone=TZ,
        )
    )
    assert row["mean_temp"] == 29.0
    assert row["worst_temp_over"] == 4.0
    assert row["temp_margin"] == 4.0


def test_the_worst_unit_is_seen_not_averaged_away() -> None:
    """⚠ 达标由最不利那台决定：一台已在带内、一台超 6 度，均值只超 1 度。"""
    row = by_name(
        build_row(
            conditions(
                {
                    "K11": {"workshop_temp_avg": 24.0},
                    "K12": {"workshop_temp_avg": 32.0},
                }
            ),
            units=UNITS,
            timezone=TZ,
        )
    )
    assert row["worst_temp_over"] == 6.0
    assert row["mean_temp"] == 28.0


def test_margin_is_negative_when_every_unit_is_inside_the_band() -> None:
    """带内余量给负数：模型要能区分「刚进带」与「富余很大」。"""
    row = by_name(
        build_row(
            conditions(
                {
                    "K11": {"workshop_temp_avg": 24.0},
                    "K12": {"workshop_temp_avg": 25.0},
                }
            ),
            units=UNITS,
            timezone=TZ,
        )
    )
    assert row["worst_temp_over"] == 0.0
    assert row["temp_margin"] == -1.0


def test_missing_readings_become_nan_not_zero() -> None:
    """⚠ 缺测是 NaN 不是 0：0 度的车间温度是一个真实且极端的值。"""
    row = by_name(build_row(conditions({}), units=UNITS, timezone=TZ))
    assert math.isnan(row["mean_temp"])
    assert math.isnan(row["worst_temp_over"])
    assert math.isnan(row["fresh_air_temp"])


def test_unknown_idle_is_nan_not_zero() -> None:
    """⚠ 旧批次没有全停时长：NaN 表示不知道，0 表示「刚停就开」。"""
    row = by_name(
        build_row(conditions({}, idle=None), units=UNITS, timezone=TZ)
    )
    assert math.isnan(row["idle_minutes"])


def test_combination_indicators_follow_the_running_set() -> None:
    """组合编码成每台一个 0/1 加台数。"""
    row = by_name(
        build_row(conditions({}, running=("K12",)), units=UNITS, timezone=TZ)
    )
    assert row["run_K11"] == 0.0
    assert row["run_K12"] == 1.0
    assert row["running_count"] == 1.0


def test_auxiliary_readings_average_over_running_units_only() -> None:
    """外部条件只看在跑的机组：停着的那台的新风温度与这次开机无关。"""
    row = by_name(
        build_row(
            conditions(
                {
                    "K11": {"fresh_air_temp": 33.0},
                    "K12": {"fresh_air_temp": 21.0},
                },
                running=("K11",),
            ),
            units=UNITS,
            timezone=TZ,
        )
    )
    assert row["fresh_air_temp"] == 33.0


def test_clock_features_use_the_room_local_time() -> None:
    """⚠ 时段按当地时折算：UTC 04:00 在上海是正午，不是凌晨。"""
    row = by_name(build_row(conditions({}), units=UNITS, timezone=TZ))
    assert row["is_work_hours"] == 1.0
    assert row["hour_sin"] == 0.0 or abs(row["hour_sin"]) < 1e-9
    assert row["hour_cos"] == -1.0 or abs(row["hour_cos"] + 1) < 1e-9


def test_a_unit_without_bands_does_not_fake_a_zero_exceedance() -> None:
    """没配范围的指标不参与超限量：不限制 ≠ 恰好压线。"""
    units = (unit("K11", upper=None), unit("K12", upper=None))
    row = dict(
        zip(
            feature_names(units),
            build_row(
                conditions({"K11": {"workshop_temp_avg": 99.0}}),
                units=units,
                timezone=TZ,
            ),
            strict=True,
        )
    )
    assert math.isnan(row["worst_temp_over"])


def test_the_matrix_keeps_the_sample_order() -> None:
    """矩阵行序与样本一致——折外预测靠下标对回样本。"""
    samples = [
        EpisodeSample(conditions=conditions({}, idle=idle), duration_minutes=1)
        for idle in (10, 20)
    ]
    matrix = build_matrix(samples, units=UNITS, timezone=TZ)
    names = feature_names(UNITS)
    at = names.index("idle_minutes")
    assert [row[at] for row in matrix] == [10.0, 20.0]


def test_setpoint_gap_needs_both_readings() -> None:
    """设定值距离要当前值与设定值都在场；只有一半就是缺测。"""
    row = by_name(
        build_row(
            conditions(
                {
                    "K11": {
                        "workshop_temp_avg": 27.0,
                        "ac_temp_setpoint": 24.0,
                    },
                    "K12": {"workshop_temp_avg": 25.0},
                }
            ),
            units=UNITS,
            timezone=TZ,
        )
    )
    assert row["setpoint_temp_gap"] == 3.0


def test_spread_measures_the_room_gradient() -> None:
    """极差量的是房间没混匀的程度：一台 24 一台 30 就是 6。"""
    row = by_name(
        build_row(
            conditions(
                {
                    "K11": {"workshop_temp_avg": 24.0},
                    "K12": {"workshop_temp_avg": 30.0},
                }
            ),
            units=UNITS,
            timezone=TZ,
        )
    )
    assert row["temp_spread"] == 6.0
    assert math.isnan(row["humidity_spread"])
