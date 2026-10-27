"""BDM 的业务时区、左闭右开窗口与上游请求分段。"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from pydantic import JsonValue

from platform_server.apps.modeling.operators.bdm import BdmSourceConfig
from platform_server.apps.modeling.services.bdm_client import BdmReadFailed
from platform_server.apps.modeling.services.frame_source import resolve_moment

MAX_WINDOW_DAYS = 366
MONTH_TEXT_LENGTH = 7


@dataclass(frozen=True)
class BdmWindow:
    since: datetime
    until: datetime
    timezone: ZoneInfo


def resolve_window(
    config: BdmSourceConfig, now: datetime, timezone: str
) -> BdmWindow:
    since = resolve_moment(config.since, now, "since")
    until = resolve_moment(config.until, now, "until") or now
    if (
        since is None
        or since >= until
        or until - since > timedelta(days=MAX_WINDOW_DAYS)
    ):
        raise BdmReadFailed("BDM 时间窗须填写起点，且大于 0、不超过 366 天")
    return BdmWindow(
        since=since.astimezone(UTC),
        until=until.astimezone(UTC),
        timezone=ZoneInfo(timezone),
    )


def history_windows(window: BdmWindow) -> Iterator[dict[str, JsonValue]]:
    """从最新的七天向前分段。Args: window。"""
    end = window.until.astimezone(window.timezone)
    if end.microsecond:
        end = end.replace(microsecond=0) + timedelta(seconds=1)
    start = window.since.astimezone(window.timezone).replace(microsecond=0)
    while start < end:
        left = max(start, end - timedelta(days=7))
        yield {
            "startTime": left.strftime("%Y-%m-%d %H:%M:%S"),
            "endTime": end.strftime("%Y-%m-%d %H:%M:%S"),
        }
        end = left


def formula_windows(
    window: BdmWindow, granularity: str
) -> Iterator[dict[str, JsonValue]]:
    """按周期起点向上游查询闭区间日期。Args: window, granularity。"""
    start = window.since.astimezone(window.timezone).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    last = (window.until - timedelta(microseconds=1)).astimezone(
        window.timezone
    )
    if granularity == "month":
        start = start.replace(day=1)
        last = last.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    while start <= last:
        left = (
            max(start, last - timedelta(days=30))
            if granularity == "day"
            else max(start, _shift_month(last, -11))
        )
        yield {
            "startDate": left.strftime("%Y-%m-%d"),
            "endDate": last.strftime("%Y-%m-%d"),
            "granularity": granularity,
        }
        last = (
            left - timedelta(days=1)
            if granularity == "day"
            else _shift_month(left, -1)
        )


def sample_time(raw: str, window: BdmWindow) -> datetime:
    text = raw + "-01" if len(raw) == MONTH_TEXT_LENGTH else raw
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise BdmReadFailed("BDM 样本包含无法识别的时间") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=window.timezone)
    return parsed.astimezone(UTC)


def _shift_month(value: datetime, count: int) -> datetime:
    month = value.year * 12 + value.month - 1 + count
    return value.replace(year=month // 12, month=month % 12 + 1, day=1)
