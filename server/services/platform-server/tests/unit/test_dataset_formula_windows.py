"""时间窗字面量与下界计算。

⚠ 两条静默出错的口径：**`m` 是分钟不是月**，以及**月与年绝不折成秒**——
`'12月'` 按 360 天算会少覆盖一个月，而数据看起来一条不缺
（docs/DATASET_DESIGN.md §5.6）。
"""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from platform_server.apps.dataset.formula import (
    MAX_WINDOW_YEARS,
    FormulaError,
    WindowSpec,
    parse_window,
    window_lower_bound,
)

SHANGHAI = ZoneInfo("Asia/Shanghai")


@pytest.mark.parametrize(
    ("literal", "amount", "unit"),
    [
        ("30s", 30, "s"),
        ("15m", 15, "m"),
        ("1h", 1, "h"),
        ("7d", 7, "d"),
        ("2w", 2, "w"),
        ("3mo", 3, "mo"),
        ("1y", 1, "y"),
        (" 3 mo ", 3, "mo"),
        ("3MO", 3, "mo"),
        ("3月", 3, "mo"),
        ("1年", 1, "y"),
        ("30秒", 30, "s"),
        ("15分钟", 15, "m"),
        ("15分", 15, "m"),
        ("2小时", 2, "h"),
        ("2时", 2, "h"),
        ("2天", 2, "d"),
        ("2日", 2, "d"),
        ("2周", 2, "w"),
    ],
)
def test_a_window_literal_normalises_to_one_spec(
    literal: str, amount: int, unit: str
) -> None:
    assert parse_window(literal) == WindowSpec(amount=amount, unit=unit)


def test_minutes_and_months_are_different_units() -> None:
    # ⚠ 历史口径，不许改：改了会让存量公式的窗口长度整体差一个量级
    assert parse_window("3m").unit == "m"
    assert parse_window("3mo").unit == "mo"


def test_the_chinese_and_ascii_spellings_share_one_cache_key() -> None:
    assert parse_window("3月").literal == parse_window("3mo").literal == "3mo"


def test_a_window_carries_a_label_for_display() -> None:
    assert parse_window("3mo").label == "3 个月"
    assert parse_window("30s").label == "30 秒"


def test_only_months_and_years_walk_the_calendar() -> None:
    assert parse_window("1y").is_calendar is True
    assert parse_window("1mo").is_calendar is True
    assert parse_window("30d").is_calendar is False


@pytest.mark.parametrize("literal", ["", "abc", "1x", "h", "-1h"])
def test_an_illegal_literal_names_the_shapes_that_do_work(
    literal: str,
) -> None:
    with pytest.raises(FormulaError, match="非法"):
        parse_window(literal)


def test_a_zero_length_window_is_rejected() -> None:
    with pytest.raises(FormulaError, match="必须大于 0"):
        parse_window("0h")


@pytest.mark.parametrize("literal", ["11y", "121mo", "3651d", "521w", "87601h"])
def test_a_window_longer_than_the_cap_is_rejected(literal: str) -> None:
    with pytest.raises(FormulaError, match="超过上限"):
        parse_window(literal)


def test_exactly_ten_years_is_still_inside_the_cap() -> None:
    # ⚠ 上限逐单位给：折成天数会把「正好 10 年」判成超限（一年约 366 天）
    assert parse_window(f"{MAX_WINDOW_YEARS}y").amount == MAX_WINDOW_YEARS
    assert parse_window(f"{MAX_WINDOW_YEARS * 12}mo").unit == "mo"


@pytest.mark.parametrize(
    ("literal", "expected"),
    [
        ("30s", datetime(2026, 3, 31, 11, 59, 30, tzinfo=UTC)),
        ("15m", datetime(2026, 3, 31, 11, 45, tzinfo=UTC)),
        ("2h", datetime(2026, 3, 31, 10, 0, tzinfo=UTC)),
        ("7d", datetime(2026, 3, 24, 12, 0, tzinfo=UTC)),
        ("1w", datetime(2026, 3, 24, 12, 0, tzinfo=UTC)),
    ],
)
def test_a_constant_length_unit_subtracts_a_constant_span(
    literal: str, expected: datetime
) -> None:
    anchor = datetime(2026, 3, 31, 12, 0, tzinfo=UTC)
    assert window_lower_bound(anchor, parse_window(literal), UTC) == expected


def test_a_month_back_clamps_to_the_last_day_of_a_shorter_month() -> None:
    # 3 月 31 日往前 1 个月是 2 月 28 日，不是 30 天前
    anchor = datetime(2026, 3, 31, 12, 0, tzinfo=UTC)
    lower = window_lower_bound(anchor, parse_window("1mo"), UTC)
    assert lower == datetime(2026, 2, 28, 12, 0, tzinfo=UTC)


def test_a_leap_year_keeps_the_twenty_ninth() -> None:
    anchor = datetime(2024, 3, 29, 12, 0, tzinfo=UTC)
    lower = window_lower_bound(anchor, parse_window("1mo"), UTC)
    assert lower == datetime(2024, 2, 29, 12, 0, tzinfo=UTC)


def test_a_year_back_is_twelve_calendar_months() -> None:
    anchor = datetime(2025, 2, 28, 12, 0, tzinfo=UTC)
    lower = window_lower_bound(anchor, parse_window("1y"), UTC)
    assert lower == datetime(2024, 2, 28, 12, 0, tzinfo=UTC)


def test_the_calendar_is_walked_in_the_business_timezone() -> None:
    # ⚠ 北京时间 07-01 03:00 在 UTC 上还是 06-30；按 UTC 字段回推一个月得到
    # 05-31 而不是 06-01——月度台账上凭空多出一天，且不报任何错
    anchor = datetime(2026, 6, 30, 19, 0, tzinfo=UTC)
    in_business_tz = window_lower_bound(anchor, parse_window("1mo"), SHANGHAI)
    in_utc = window_lower_bound(anchor, parse_window("1mo"), UTC)
    assert in_business_tz == datetime(2026, 5, 31, 19, 0, tzinfo=UTC)
    assert in_utc == datetime(2026, 5, 30, 19, 0, tzinfo=UTC)


def test_a_naive_anchor_is_read_as_utc_rather_than_machine_local_time() -> None:
    # ⚠ `astimezone` 会把裸 datetime 当成**机器本地时区**，同一份代码在开发机
    # 与容器里于是算出两个下界
    naive = datetime(2026, 3, 31, 12, 0)  # noqa: DTZ001 - 正是要测这一路
    lower = window_lower_bound(naive, parse_window("1mo"), UTC)
    assert lower == datetime(2026, 2, 28, 12, 0, tzinfo=UTC)
