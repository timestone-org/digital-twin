"""时间口径：一律 UTC aware，对外序列化为 RFC3339 毫秒精度带 Z。"""

from collections.abc import Callable
from datetime import UTC, datetime

Clock = Callable[[], datetime]


def utcnow() -> datetime:
    """当前 UTC 时刻（aware）。"""
    return datetime.now(UTC)


def to_utc(value: datetime) -> datetime:
    """把任意 datetime 归一为 UTC aware。

    Args: value（naive 视为 UTC）。
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def format_rfc3339(value: datetime) -> str:
    """序列化为 `2026-08-10T09:30:00.000Z`。

    Args: value。
    """
    normalized = to_utc(value)
    millis = normalized.microsecond // 1000
    return f"{normalized:%Y-%m-%dT%H:%M:%S}" f".{millis:03d}Z"
