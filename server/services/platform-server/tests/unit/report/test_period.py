"""报告期的业务日历、半开边界和最新锚点。"""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from platform_server.apps.report.services.period import (
    WindowOptions,
    bounds,
    parse_period,
    resolve_window,
)


def test_month_bounds_use_business_timezone():
    start, end = bounds("2024-02", "month", ZoneInfo("Asia/Shanghai"))
    assert start.astimezone(UTC).isoformat() == "2024-01-31T16:00:00+00:00"
    assert end.astimezone(UTC).isoformat() == "2024-02-29T16:00:00+00:00"


def test_previous_month_is_calendar_month():
    start, end = resolve_window(
        "2024-03", "month", UTC, WindowOptions(offset=-1)
    )
    assert (start.day, start.month, end.month) == (1, 2, 3)
    assert (end - start).days == 29


def test_latest_never_moves_report_into_future():
    start, end = resolve_window(
        "2026-06",
        "month",
        UTC,
        WindowOptions(latest=datetime(2026, 12, 1, tzinfo=UTC)),
    )
    assert start == datetime(2026, 6, 1, tzinfo=UTC)
    assert end == datetime(2026, 7, 1, tzinfo=UTC)


def test_latest_includes_its_own_row():
    start, end = resolve_window(
        "2026-06",
        "month",
        UTC,
        WindowOptions(latest=datetime(2026, 4, 12, tzinfo=UTC)),
    )
    assert start == datetime(2026, 4, 1, tzinfo=UTC)
    assert end == datetime(2026, 4, 12, 0, 0, 0, 1, tzinfo=UTC)


@pytest.mark.parametrize("period", ["2026-13", "0000-01", "2026-02x"])
def test_invalid_month_is_rejected(period):
    with pytest.raises(ValueError, match=r"."):
        parse_period(period, "month")


def test_daylight_saving_day_has_real_elapsed_duration():
    start, end = bounds("2026-03-08", "day", ZoneInfo("America/New_York"))
    assert (
        end.astimezone(UTC) - start.astimezone(UTC)
    ).total_seconds() == 23 * 3600
