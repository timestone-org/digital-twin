"""分片的切法与每片的取数区间 —— 纯函数，不碰数据库也不碰队列。

分片按「房间 + 月」，每片独立幂等、失败可单独重试；口径见
docs/AC_STARTUP_DESIGN.md §5。
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules

# 月份键的字面量形式，同时是队列消息里的取值
MONTH_FORMAT = "%Y-%m"
_MONTHS_IN_YEAR = 12


@dataclass(frozen=True)
class ExtractRange:
    """一次抽取的两个区间。

    ⚠ **归属区间决定写哪些事件，取数区间决定读哪些数据，两者不是同一个。**
    写按起始时刻归属，读必须向两侧越界：向前够判冷启动、向后够判达标上限。
    """

    write_start: datetime
    write_end: datetime
    read_start: datetime
    read_end: datetime

    def owns(self, started_at: datetime) -> bool:
        """这次开机的起始时刻归不归本次写。左闭右开。

        Args: started_at。
        """
        return self.write_start <= started_at < self.write_end


@dataclass(frozen=True)
class ShardRange(ExtractRange):
    """一片的区间，外加它是哪个月。"""

    month: str


def month_key(moment: datetime) -> str:
    """一个时刻落在哪个月。

    Args: moment。
    """
    return moment.astimezone(UTC).strftime(MONTH_FORMAT)


def month_start(month: str) -> datetime:
    """月份键对应的月初 UTC 时刻。

    Args: month（`YYYY-MM`）。
    """
    return datetime.strptime(month, MONTH_FORMAT).replace(tzinfo=UTC)


def next_month_start(moment: datetime) -> datetime:
    """下个月的月初 UTC 时刻。

    Args: moment。
    """
    if moment.month == _MONTHS_IN_YEAR:
        return moment.replace(year=moment.year + 1, month=1)
    return moment.replace(month=moment.month + 1)


def plan_months(window_start: datetime, window_end: datetime) -> list[str]:
    """抽取区间覆盖到的全部月份键，按时间升序。

    ⚠ 区间右端是开区间：正好落在月初的 `window_end` 不该多切出一片空月。
    Args: window_start, window_end。
    """
    if window_end <= window_start:
        return []
    months: list[str] = []
    cursor = window_start.astimezone(UTC).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    while cursor < window_end:
        months.append(cursor.strftime(MONTH_FORMAT))
        cursor = next_month_start(cursor)
    return months


def shard_range(
    month: str,
    *,
    window_start: datetime,
    window_end: datetime,
    rules: ExtractionRules,
) -> ShardRange:
    """一片的归属区间与取数区间。

    ⚠ 取数向前多读 `max(cold_off, idle_lookback)`（判冷启动 + 数全停时长）、
    向后多读 `compliance_cap_minutes`。读也卡死在月界内的话，跨月的那次开机
    会在前一片里被判成「没达标」、在后一片里根本看不到起始——**一次开机凭空
    消失，而两片都报成功**。
    Args: month, window_start, window_end, rules。
    """
    start = month_start(month)
    write_start = max(start, window_start)
    write_end = min(next_month_start(start), window_end)
    lookback = max(rules.cold_off_minutes, rules.idle_lookback_minutes)
    return ShardRange(
        month=month,
        write_start=write_start,
        write_end=write_end,
        read_start=write_start - timedelta(minutes=lookback),
        read_end=write_end + timedelta(minutes=rules.compliance_cap_minutes),
    )


def daily_range(
    day_start: datetime, day_end: datetime, *, rules: ExtractionRules
) -> ExtractRange:
    """一天增量的归属区间与取数区间。

    ⚠ **归属区间的左端要往回退一个达标上限**，这是这段代码里最关键的一行。
    00:00 触发时，当天最后 100 分钟里开的机还没跑完——判达标要向后读 100 分钟，
    而那 100 分钟的数据尚未产生。不往回退的话，每天 22:20 之后的开机会被永久
    判成「没达标」并就此定格。往回退一个达标上限，昨夜那一段就在今晚被带着
    完整数据**重判一次**，结论覆盖旧的（docs/AC_PUBLISH_DESIGN.md §6.2）。

    Args: day_start, day_end, rules。
    """
    lookback = max(rules.cold_off_minutes, rules.idle_lookback_minutes)
    write_start = day_start - timedelta(minutes=rules.compliance_cap_minutes)
    return ExtractRange(
        write_start=write_start,
        write_end=day_end,
        read_start=write_start - timedelta(minutes=lookback),
        read_end=day_end + timedelta(minutes=rules.compliance_cap_minutes),
    )
