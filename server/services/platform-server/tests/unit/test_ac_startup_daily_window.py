"""每日增量的窗口口径——纯函数，不碰库也不碰队列。

⚠ 这一组守的是**归属区间左端要往回退一个达标上限**那一条。00:00 触发时，
当天最后 100 分钟里开的机还没跑完；不往回退的话，每天 22:20 之后的开机会被
永久判成「没达标」并就此定格，而没有任何地方会报错。
"""

from datetime import UTC, date, datetime, timedelta

from platform_server.apps.hvac.services.ac_startup_daily import (
    day_bounds,
    format_business_date,
    local_today,
    parse_business_date,
)
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_shards import daily_range

RULES = ExtractionRules()
SHANGHAI = "Asia/Shanghai"
DAY = date(2026, 8, 12)


def test_a_business_day_is_cut_in_the_business_timezone() -> None:
    """业务日按业务时区切，不按 UTC 切。

    ⚠ 按 UTC 切出来的一天会把东八区的早班劈成两半。
    """
    bounds = day_bounds(DAY, SHANGHAI)
    assert bounds.start == datetime(2026, 8, 11, 16, tzinfo=UTC)
    assert bounds.end == datetime(2026, 8, 12, 16, tzinfo=UTC)


def test_the_write_window_starts_one_compliance_cap_early() -> None:
    """归属区间的左端 = 当天 00:00 − 达标上限。

    这一条是整个日增量能自洽的前提：昨夜最后那段开机在今晚被带着完整数据
    重判一次，结论覆盖旧的。
    """
    bounds = day_bounds(DAY, SHANGHAI)
    window = daily_range(bounds.start, bounds.end, rules=RULES)
    assert window.write_start == bounds.start - timedelta(
        minutes=RULES.compliance_cap_minutes
    )
    assert window.write_end == bounds.end


def test_the_read_window_overhangs_on_both_sides() -> None:
    """取数向前够判冷启动与全停时长、向后够判达标上限。"""
    bounds = day_bounds(DAY, SHANGHAI)
    window = daily_range(bounds.start, bounds.end, rules=RULES)
    lookback = max(RULES.cold_off_minutes, RULES.idle_lookback_minutes)
    assert window.read_start == window.write_start - timedelta(minutes=lookback)
    assert window.read_end == window.write_end + timedelta(
        minutes=RULES.compliance_cap_minutes
    )


def test_two_consecutive_days_overlap_exactly_by_one_cap() -> None:
    """相邻两天的归属区间**必须**重叠一个达标上限，不多也不少。

    ⚠ 不重叠就丢掉昨夜的尾巴；重叠更多则每晚白重判一大段，而外库是别人的。
    """
    first = day_bounds(DAY, SHANGHAI)
    second = day_bounds(DAY + timedelta(days=1), SHANGHAI)
    earlier = daily_range(first.start, first.end, rules=RULES)
    later = daily_range(second.start, second.end, rules=RULES)
    overlap = earlier.write_end - later.write_start
    assert overlap == timedelta(minutes=RULES.compliance_cap_minutes)


def test_the_window_owns_its_left_edge_and_not_its_right() -> None:
    """归属判定左闭右开，相邻两天才不会各写一份同一次开机。"""
    bounds = day_bounds(DAY, SHANGHAI)
    window = daily_range(bounds.start, bounds.end, rules=RULES)
    assert window.owns(window.write_start) is True
    assert window.owns(window.write_end) is False


def test_a_business_date_survives_a_round_trip() -> None:
    """业务日进出队列信封不变形。"""
    assert parse_business_date(format_business_date(DAY)) == DAY


def test_an_unreadable_business_date_is_none_not_an_exception() -> None:
    """读不懂的日期给 None——消费端据此把消息记成读不懂再确认丢弃。"""
    assert parse_business_date("2026-13-40") is None
    assert parse_business_date("") is None


def test_the_local_day_follows_the_business_timezone() -> None:
    """UTC 的 16:00 在东八区已经是第二天了。"""
    at = datetime(2026, 8, 11, 16, 30, tzinfo=UTC)
    assert local_today(SHANGHAI, now=at) == DAY
