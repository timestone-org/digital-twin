"""年度冬季边界、逐台独立范围及抽取与训练的一致口径。"""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import partial

import pytest

from platform_server.apps.hvac.modeling.curation import curate
from platform_server.apps.hvac.modeling.features import (
    EpisodeSample,
    StartConditions,
    build_row,
    feature_names,
)
from platform_server.apps.hvac.rooms import MetricBand, RoomUnit
from platform_server.apps.hvac.seasons import WinterPeriod
from platform_server.apps.hvac.services.ac_room_configuration import (
    BoundUnit,
    RoomConfiguration,
    restore_configuration,
)
from platform_server.apps.hvac.services.ac_source_reader import SourceRow
from platform_server.apps.hvac.services.ac_startup_frames import (
    build_frames,
    compliant_at,
)
from platform_server.apps.hvac.services.ac_startup_rules import (
    ExtractionRules,
    extract_episodes,
)

TZ = "Asia/Shanghai"
WINTER = WinterPeriod("11-15", "03-15")


def seasonal_unit(serial: str = "K01") -> RoomUnit:
    return RoomUnit(
        serial,
        {
            "workshop_temp_avg": MetricBand(Decimal(24), Decimal(28)),
            "workshop_humidity_avg": MetricBand(Decimal(55), Decimal(65)),
        },
        WINTER,
        {
            "workshop_temp_avg": MetricBand(Decimal(20), Decimal(24)),
            "workshop_humidity_avg": MetricBand(Decimal(45), Decimal(55)),
        },
    )


@pytest.mark.parametrize(
    ("at", "is_expected_winter"),
    [
        ("2026-11-14T15:59:00+00:00", False),
        ("2026-11-14T16:00:00+00:00", True),
        ("2027-01-01T00:00:00+00:00", True),
        ("2027-03-15T15:59:00+00:00", True),
        ("2027-03-15T16:00:00+00:00", False),
        ("2028-02-29T00:00:00+00:00", True),
    ],
)
def test_cross_year_period_uses_business_date(
    at: str, is_expected_winter: bool
) -> None:
    assert WINTER.contains(datetime.fromisoformat(at), TZ) is is_expected_winter


@pytest.mark.parametrize("day", ["02-30", "13-01", "00-01", "1-01", "11-15\n"])
def test_invalid_month_days_are_rejected(day: str) -> None:
    with pytest.raises(ValueError, match=r"日期|month|day"):
        WinterPeriod(day, "03-15")


def test_same_year_and_single_day_periods_are_inclusive() -> None:
    at = datetime(2026, 3, 1, tzinfo=UTC)
    assert WinterPeriod("02-01", "03-01").contains(at, TZ)
    assert WinterPeriod("03-01", "03-01").contains(at, TZ)
    assert not WinterPeriod("03-01", "03-01").contains(
        at + timedelta(days=1), TZ
    )


def test_naive_timestamp_cannot_choose_a_season() -> None:
    with pytest.raises(ValueError, match="时区"):
        WINTER.contains(datetime.fromisoformat("2026-01-01T00:00:00"), TZ)


def test_no_period_uses_non_winter_even_in_january() -> None:
    unit = replace(seasonal_unit(), winter_period=None)
    resolved = unit.at(datetime(2026, 1, 1, tzinfo=UTC), TZ)
    assert resolved.bands["workshop_temp_avg"].lower == Decimal(24)
    assert unit.season_at(datetime(2026, 1, 1, tzinfo=UTC), TZ) == "non_winter"


def sample(at: datetime, duration_minutes: int) -> EpisodeSample:
    return EpisodeSample(
        StartConditions(
            at,
            ("K01",),
            60,
            {"K01": {"workshop_temp_avg": 22.0, "workshop_humidity_avg": 50.0}},
        ),
        duration_minutes,
    )


def test_features_and_curation_use_each_samples_own_season() -> None:
    unit = seasonal_unit()
    winter = sample(datetime(2026, 1, 1, tzinfo=UTC), 0)
    summer = sample(datetime(2026, 7, 1, tzinfo=UTC), 15)
    names = feature_names([unit])
    cold = dict(
        zip(
            names,
            build_row(winter.conditions, units=[unit], timezone=TZ),
            strict=True,
        )
    )
    warm = dict(
        zip(
            names,
            build_row(summer.conditions, units=[unit], timezone=TZ),
            strict=True,
        )
    )
    assert (
        cold["worst_temp_over"],
        cold["worst_humidity_over"],
        cold["winter_K01"],
    ) == (0.0, 0.0, 1.0)
    assert (
        warm["worst_temp_over"],
        warm["worst_humidity_over"],
        warm["winter_K01"],
    ) == (2.0, 5.0, 0.0)
    curated = curate([winter, summer], units=[unit], timezone=TZ)
    assert curated.kept == (winter, summer)
    assert curated.contradictory_count == curated.unexplained_zero_count == 0


def test_units_in_same_room_can_have_different_seasons() -> None:
    first = seasonal_unit()
    second = replace(
        seasonal_unit("K02"), winter_period=WinterPeriod("12-01", "02-28")
    )
    at = datetime(2026, 11, 20, tzinfo=UTC)
    values = {
        "workshop_temp_avg": 22.0,
        "workshop_humidity_avg": 50.0,
        "fan_frequency": 40.0,
    }
    frames = build_frames(
        [first, second],
        {
            unit.serial: [SourceRow(ts=at, values=values)]
            for unit in (first, second)
        },
        timezone=TZ,
    )
    assert first.season_at(at, TZ) == "winter"
    assert second.season_at(at, TZ) == "non_winter"
    assert frames[0].is_compliant is False


def test_episode_keeps_starting_target_across_season_boundary() -> None:
    unit = seasonal_unit()
    started = datetime(2026, 11, 14, 15, 59, tzinfo=UTC)
    rows = [
        SourceRow(
            ts=started + timedelta(minutes=offset),
            values={
                "fan_frequency": 0.0 if offset < 0 else 40.0,
                "workshop_temp_avg": 22.0 if offset < 2 else 26.0,
                "workshop_humidity_avg": 50.0 if offset < 2 else 60.0,
            },
        )
        for offset in range(-35, 5)
    ]
    frames = build_frames([unit], {unit.serial: rows}, timezone=TZ)
    found = extract_episodes(
        frames,
        rules=ExtractionRules(),
        compliance=partial(compliant_at, units=[unit], timezone=TZ),
    )
    assert len(found) == 1
    assert found[0].duration_minutes == 2


def test_configuration_roundtrip_preserves_rules_and_both_seasons() -> None:
    rules = ExtractionRules(cold_off_minutes=45)
    original = RoomConfiguration(
        (BoundUnit(seasonal_unit(), "v_K01"),),
        ("K01",),
        TZ,
        rules.fingerprint(),
        rules,
    )
    restored = restore_configuration(original.snapshot())
    assert restored == original
    assert restored.fingerprint() == original.fingerprint()
    changed = replace(
        original,
        units=(
            BoundUnit(
                replace(
                    seasonal_unit(),
                    winter_period=WinterPeriod("11-01", "03-15"),
                ),
                "v_K01",
            ),
        ),
    )
    assert changed.fingerprint() != original.fingerprint()
