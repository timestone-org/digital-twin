"""能管业务时区、查询边界与日/月/分时请求分段。"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from pydantic import JsonValue

from platform_server.apps.modeling.operators.bdm import (
    MINUTE_INTERVALS,
    BdmSourceConfig,
)
from platform_server.apps.modeling.services.bdm_client import BdmReadFailed
from platform_server.apps.modeling.services.frame_source import resolve_moment

MONTH_TEXT_LENGTH = 7
MAX_FORMULA_PERIODS = 500


@dataclass(frozen=True)
class BdmWindow:
    since: datetime
    until: datetime
    timezone: ZoneInfo


def resolve_window(
    config: BdmSourceConfig, now: datetime, timezone: str
) -> BdmWindow:
    try:
        since = resolve_moment(config.since, now, "since")
        until = resolve_moment(config.until, now, "until") or now
        if since is None or since >= until:
            raise BdmReadFailed("能管时间窗须填写起点，且起点必须早于终点")
        window = BdmWindow(
            since.astimezone(UTC), until.astimezone(UTC), ZoneInfo(timezone)
        )
        if config.kind == "formula" and config.granularity in (
            "hour",
            "minute",
        ):
            return align_intraday(window, config)
        return window
    except OverflowError:
        raise BdmReadFailed(
            "能管时间范围超出支持范围，请调整起止时刻"
        ) from None


def is_interval_aligned(value: datetime, minutes: int) -> bool:
    return (
        value.minute % minutes == 0
        and value.second == 0
        and value.microsecond == 0
    )


def align_intraday(window: BdmWindow, config: BdmSourceConfig) -> BdmWindow:
    """严格校验或向内对齐完整周期。Args: window, config。"""
    minutes = config.effective_interval_minutes
    since = window.since.astimezone(window.timezone)
    until = window.until.astimezone(window.timezone)
    if config.time_alignment == "strict":
        if not all(
            is_interval_aligned(value, minutes) for value in (since, until)
        ):
            raise BdmReadFailed(
                f"分时起止时刻须按 {minutes} 分钟对齐，秒及小数秒须为 0"
            )
        return window
    start = _floor_interval(since, minutes)
    if start < since:
        start += timedelta(minutes=minutes)
    end = _floor_interval(until, minutes)
    if start >= end:
        raise BdmReadFailed(f"所选时间范围不包含一个完整的 {minutes} 分钟周期")
    return BdmWindow(
        start.astimezone(UTC), end.astimezone(UTC), window.timezone
    )


def _floor_interval(value: datetime, minutes: int) -> datetime:
    return value.replace(
        minute=value.minute - value.minute % minutes, second=0, microsecond=0
    )


def history_windows(window: BdmWindow) -> Iterator[dict[str, JsonValue]]:
    """从最新的七天向前分段。Args: window。"""
    end = window.until.astimezone(window.timezone)
    if end.microsecond:
        end = end.replace(microsecond=0) + timedelta(seconds=1)
    start = window.since.astimezone(window.timezone).replace(microsecond=0)
    while start < end:
        left = end - min(end - start, timedelta(days=7))
        yield {
            "startTime": left.strftime("%Y-%m-%d %H:%M:%S"),
            "endTime": end.strftime("%Y-%m-%d %H:%M:%S"),
        }
        end = left


def formula_windows(
    window: BdmWindow, granularity: str, interval_minutes: int | None = None
) -> Iterator[dict[str, JsonValue]]:
    """日/月包含结束日，分时左闭右开。

    Args: window, granularity, interval_minutes。
    """
    if granularity in ("hour", "minute"):
        yield from _intraday_windows(window, granularity, interval_minutes)
    elif granularity in ("day", "month"):
        yield from _calendar_windows(window, granularity)
    else:
        raise BdmReadFailed("不支持的能管公式粒度")


def _intraday_windows(
    window: BdmWindow, granularity: str, interval_minutes: int | None
) -> Iterator[dict[str, JsonValue]]:
    minutes = 60 if granularity == "hour" else interval_minutes or 1
    if minutes not in MINUTE_INTERVALS:
        raise BdmReadFailed("不支持的能管分钟间隔")
    start = window.since.astimezone(window.timezone)
    end = window.until.astimezone(window.timezone)
    span = timedelta(minutes=minutes * MAX_FORMULA_PERIODS)
    while start < end:
        left = end - min(end - start, span)
        yield {
            "startDate": left.strftime("%Y-%m-%d %H:%M:%S"),
            "endDate": end.strftime("%Y-%m-%d %H:%M:%S"),
            "granularity": granularity,
            "intervalMinutes": minutes,
        }
        end = left


def _calendar_windows(
    window: BdmWindow, granularity: str
) -> Iterator[dict[str, JsonValue]]:
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
        left = _calendar_left(start, last, granularity)
        yield {
            "startDate": left.strftime("%Y-%m-%d"),
            "endDate": last.strftime("%Y-%m-%d"),
            "granularity": granularity,
        }
        if left <= start:
            break
        last = (
            left - timedelta(days=1)
            if granularity == "day"
            else _shift_month(left, -1)
        )


def _calendar_left(
    start: datetime, last: datetime, granularity: str
) -> datetime:
    if granularity == "day":
        return last - min(last - start, timedelta(days=30))
    count = min((last.year - start.year) * 12 + last.month - start.month, 11)
    return _shift_month(last, -count)


def sample_time(raw: str, window: BdmWindow) -> datetime:
    text = raw + "-01" if len(raw) == MONTH_TEXT_LENGTH else raw
    try:
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=window.timezone)
        return parsed.astimezone(UTC)
    except (ValueError, OverflowError):
        raise BdmReadFailed("能管样本包含无法识别的时间") from None


def _shift_month(value: datetime, count: int) -> datetime:
    month = value.year * 12 + value.month - 1 + count
    return value.replace(year=month // 12, month=month % 12 + 1, day=1)
