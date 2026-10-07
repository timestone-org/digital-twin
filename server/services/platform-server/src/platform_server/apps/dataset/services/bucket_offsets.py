"""桶网格使用的纯日期边界保护与 UTC 时区偏移分段。"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import wraps
from zoneinfo import ZoneInfo

from lib.utils.timeutils import to_utc

_EPSILON = timedelta(microseconds=1)
# IANA 相邻时区跳变之间超过半天，探测后精确二分到微秒边界。
_PROBE = timedelta(hours=12)


@dataclass(frozen=True)
class OffsetSegment:
    """一段真实 UTC 时刻使用的当地偏移。"""

    since: datetime
    until: datetime
    offset: timedelta


def datetime_boundary[**P, R](function: Callable[P, R]) -> Callable[P, R]:
    """把无法表示的日期或完整 preimage 边界转成校验错误。

    Args: function。
    """

    @wraps(function)
    def checked(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return function(*args, **kwargs)
        except OverflowError as exc:
            raise ValueError("日期边界无法表示完整桶区间") from exc

    return checked


def offset_segments(
    since: datetime, until: datetime, zone: ZoneInfo
) -> tuple[OffsetSegment, ...]:
    """按真实 UTC 偏移拆分区间。

    Args: since, until, zone。
    """
    since, until = to_utc(since), to_utc(until)
    found: list[OffsetSegment] = []
    cursor, begin, offset = since, since, _offset(since, zone)
    while cursor < until:
        probe = min(cursor + _PROBE, until)
        following = _offset(probe, zone)
        if following != offset:
            edge = _transition(cursor, probe, zone)
            found.append(OffsetSegment(begin, edge, offset))
            begin, offset = edge, following
        cursor = probe
    if begin < until:
        found.append(OffsetSegment(begin, until, offset))
    return tuple(found)


def _offset(moment: datetime, zone: ZoneInfo) -> timedelta:
    """一个真实 UTC 时刻的当地偏移。

    Args: moment, zone。
    """
    offset = moment.astimezone(zone).utcoffset()
    if offset is None:
        raise ValueError("时区没有 UTC 偏移")
    return offset


def _transition(left: datetime, right: datetime, zone: ZoneInfo) -> datetime:
    """在偏移不同的两端之间定位跳变右开界。

    Args: left, right, zone。
    """
    before = _offset(left, zone)
    while right - left > _EPSILON:
        middle = left + ((right - left) // _EPSILON // 2) * _EPSILON
        if _offset(middle, zone) == before:
            left = middle
        else:
            right = middle
    return right
