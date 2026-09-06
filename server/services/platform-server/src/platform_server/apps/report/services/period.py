"""报告期的日历运算与半开时间窗，业务时区显式注入。"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, tzinfo

from platform_server.apps.dataset.services import report_formula
from platform_server.apps.report.schemas.common import Granularity

_PERIOD_PATTERNS = {
    "day": r"^(\d{4})-(\d{2})-(\d{2})$",
    "month": r"^(\d{4})-(\d{2})$",
    "quarter": r"^(\d{4})Q([1-4])$",
    "year": r"^(\d{4})$",
}
_MONTHS = {"month": 1, "quarter": 3, "year": 12}
_EPSILON = timedelta(microseconds=1)


@dataclass(frozen=True)
class WindowOptions:
    """相对报告期的取数参数。"""

    offset: int = 0
    window: str | None = None
    latest: datetime | None = None


def parse_period(period: str, granularity: Granularity) -> datetime:
    """解析为 UTC 日历占位时刻。Args: period, granularity。"""
    match = re.fullmatch(_PERIOD_PATTERNS[granularity], period)
    if match is None:
        raise ValueError("报告期格式与粒度不匹配")
    parts = [int(value) for value in match.groups()]
    year = parts[0]
    month = parts[1] if len(parts) > 1 else 1
    if granularity == "quarter":
        month = (month - 1) * 3 + 1
    day = parts[-1] if granularity == "day" else 1
    return datetime(year, month, day, tzinfo=UTC)


def format_period(moment: datetime, granularity: Granularity) -> str:
    """格式化业务日历上的报告期。Args: moment, granularity。"""
    if granularity == "quarter":
        return f"{moment.year:04d}Q{(moment.month - 1) // 3 + 1}"
    patterns = {"day": "%Y-%m-%d", "month": "%Y-%m", "year": "%Y"}
    return moment.strftime(patterns[granularity])


def shift(moment: datetime, granularity: Granularity, offset: int) -> datetime:
    """移动整数个日历报告期。Args: moment, granularity, offset。"""
    if granularity == "day":
        return moment + timedelta(days=offset)
    months = moment.year * 12 + moment.month - 1 + _MONTHS[granularity] * offset
    return moment.replace(year=months // 12, month=months % 12 + 1, day=1)


def bounds(
    period: str, granularity: Granularity, zone: tzinfo
) -> tuple[datetime, datetime]:
    """报告期的左闭右开边界。Args: period, granularity, zone。"""
    start = parse_period(period, granularity).replace(tzinfo=zone)
    return start, shift(start, granularity, 1)


def resolve_window(
    period: str, granularity: Granularity, zone: tzinfo, options: WindowOptions
) -> tuple[datetime, datetime]:
    """解析有界窗口。Args: period, granularity, zone, options。"""
    start = shift(
        parse_period(period, granularity).replace(tzinfo=zone),
        granularity,
        options.offset,
    )
    end = shift(start, granularity, 1)
    if options.latest is not None:
        latest = options.latest.astimezone(zone)
        if latest + _EPSILON < end:
            end = latest + _EPSILON
            start, _ = bounds(
                format_period(latest, granularity), granularity, zone
            )
    if options.window:
        start = report_formula.window_lower_bound(
            end, report_formula.parse_window(options.window), zone
        )
    return start.astimezone(UTC), end.astimezone(UTC)
