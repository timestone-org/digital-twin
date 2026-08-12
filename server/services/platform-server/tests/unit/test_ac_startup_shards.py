"""分片切法与取数区间的用例 —— 守的是「跨月的那次开机不会消失」。

⚠ 写按起始时刻归属、读必须向两侧越界。读也卡死在月界内的话，跨月的那次开机
会在前一片里被判成没达标、在后一片里根本看不到起始，而两片都报成功。
"""

from datetime import UTC, datetime

import pytest

from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_shards import (
    month_key,
    month_start,
    next_month_start,
    plan_months,
    shard_range,
)

RULES = ExtractionRules()
WINDOW_START = datetime(2026, 1, 1, tzinfo=UTC)
WINDOW_END = datetime(2026, 4, 1, tzinfo=UTC)


def test_the_plan_covers_every_month_the_window_touches() -> None:
    """区间碰到的每个月都要切出一片，一片不多一片不少。"""
    assert plan_months(
        datetime(2026, 1, 20, tzinfo=UTC), datetime(2026, 3, 5, tzinfo=UTC)
    ) == ["2026-01", "2026-02", "2026-03"]


def test_a_window_ending_exactly_on_a_month_boundary_adds_no_empty_shard() -> (
    None
):
    """右端是开区间：正好落在月初不该多切一片空月。"""
    assert plan_months(WINDOW_START, datetime(2026, 2, 1, tzinfo=UTC)) == [
        "2026-01"
    ]


@pytest.mark.parametrize(
    ("start", "end"),
    [
        (WINDOW_START, WINDOW_START),
        (WINDOW_END, WINDOW_START),
    ],
    ids=["empty", "inverted"],
)
def test_an_empty_or_inverted_window_plans_nothing(
    start: datetime, end: datetime
) -> None:
    """空的或倒置的区间抽不出任何东西，也就没有分片。"""
    assert plan_months(start, end) == []


def test_the_plan_crosses_a_year_boundary() -> None:
    """跨年时月份键要进位到下一年。"""
    assert plan_months(
        datetime(2025, 12, 10, tzinfo=UTC), datetime(2026, 1, 10, tzinfo=UTC)
    ) == ["2025-12", "2026-01"]


def test_the_month_of_a_moment_is_its_utc_month() -> None:
    """月份键按 UTC 算，与批次区间同一个口径。"""
    assert month_key(datetime(2026, 3, 31, 23, 59, tzinfo=UTC)) == "2026-03"


def test_a_month_key_round_trips_through_its_start() -> None:
    """月份键 → 月初时刻 → 月份键，逐字回到原样。"""
    assert month_key(month_start("2026-07")) == "2026-07"


def test_december_rolls_into_the_next_january() -> None:
    """12 月的下一个月是明年 1 月。"""
    assert next_month_start(datetime(2026, 12, 1, tzinfo=UTC)) == datetime(
        2027, 1, 1, tzinfo=UTC
    )


def test_a_shard_owns_exactly_its_own_month() -> None:
    """归属区间左闭右开，正好落在月初的那一刻归后一片。"""
    window = shard_range(
        "2026-02",
        window_start=WINDOW_START,
        window_end=WINDOW_END,
        rules=RULES,
    )
    assert window.write_start == datetime(2026, 2, 1, tzinfo=UTC)
    assert window.write_end == datetime(2026, 3, 1, tzinfo=UTC)
    assert window.owns(datetime(2026, 2, 1, tzinfo=UTC)) is True
    assert window.owns(datetime(2026, 2, 28, 23, 59, tzinfo=UTC)) is True
    assert window.owns(datetime(2026, 3, 1, tzinfo=UTC)) is False
    assert window.owns(datetime(2026, 1, 31, 23, 59, tzinfo=UTC)) is False


def test_the_read_window_overruns_both_ends() -> None:
    """⚠ 向前 30 分钟够判冷启动、向后 100 分钟够判达标上限。"""
    window = shard_range(
        "2026-02",
        window_start=WINDOW_START,
        window_end=WINDOW_END,
        rules=RULES,
    )
    assert window.read_start == datetime(2026, 1, 31, 23, 30, tzinfo=UTC)
    assert window.read_end == datetime(2026, 3, 1, 1, 40, tzinfo=UTC)


def test_the_read_overrun_follows_the_rules_not_a_constant() -> None:
    """越界宽度由当前参数决定：改了门槛，取数区间要跟着变。"""
    window = shard_range(
        "2026-02",
        window_start=WINDOW_START,
        window_end=WINDOW_END,
        rules=ExtractionRules(cold_off_minutes=45, compliance_cap_minutes=200),
    )
    assert window.read_start == datetime(2026, 1, 31, 23, 15, tzinfo=UTC)
    assert window.read_end == datetime(2026, 3, 1, 3, 20, tzinfo=UTC)


def test_the_shard_is_clamped_to_the_batch_window() -> None:
    """批次区间从月中开始时，首片的归属区间不该往前多吃半个月。"""
    window = shard_range(
        "2026-01",
        window_start=datetime(2026, 1, 20, 8, 0, tzinfo=UTC),
        window_end=datetime(2026, 1, 25, 8, 0, tzinfo=UTC),
        rules=RULES,
    )
    assert window.write_start == datetime(2026, 1, 20, 8, 0, tzinfo=UTC)
    assert window.write_end == datetime(2026, 1, 25, 8, 0, tzinfo=UTC)


def test_adjacent_shards_tile_the_window_without_gap_or_overlap() -> None:
    """相邻两片的归属区间首尾相接：不重叠才不会写两份，不留缝才不会漏。"""
    ranges = [
        shard_range(
            month,
            window_start=WINDOW_START,
            window_end=WINDOW_END,
            rules=RULES,
        )
        for month in plan_months(WINDOW_START, WINDOW_END)
    ]
    assert [item.write_start for item in ranges] == [
        datetime(2026, 1, 1, tzinfo=UTC),
        datetime(2026, 2, 1, tzinfo=UTC),
        datetime(2026, 3, 1, tzinfo=UTC),
    ]
    assert [item.write_end for item in ranges[:-1]] == [
        ranges[1].write_start,
        ranges[2].write_start,
    ]
    assert ranges[-1].write_end == WINDOW_END
