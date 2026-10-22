"""每年重复的冬季时段；按业务时区的月日选择，起止日均包含。"""

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

Season = Literal["winter", "non_winter"]


def month_day(value: str) -> tuple[int, int]:
    """校验月日；闰日可以作为年度边界。Args: value。"""
    if re.fullmatch(r"\d{2}-\d{2}", value) is None:
        raise ValueError("日期应为 MM-DD")
    parsed = date.fromisoformat(f"2000-{value}")
    return parsed.month, parsed.day


@dataclass(frozen=True)
class WinterPeriod:
    """一台空调的年度冬季时段。"""

    start: str
    end: str

    def __post_init__(self) -> None:
        month_day(self.start)
        month_day(self.end)

    def contains(self, at: datetime, timezone: str) -> bool:
        """判断业务日期是否属于冬季。Args: at, timezone。"""
        if at.tzinfo is None or at.utcoffset() is None:
            raise ValueError("季节判定需要带时区的时间")
        local = at.astimezone(ZoneInfo(timezone))
        current = (local.month, local.day)
        start, end = month_day(self.start), month_day(self.end)
        if start <= end:
            return start <= current <= end
        return current >= start or current <= end
