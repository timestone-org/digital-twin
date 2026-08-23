"""时间窗字面量：`'1h'` / `'3mo'` / `'3月'` → 规范写法 + 下界计算。

⚠ **`m` 是分钟，月要写 `mo` 或 `月`**。
⚠ **月与年绝不折成秒**：它们是 28~31 天 / 365~366 天，只有相对一个具体时刻
才定得下边界。`'12月'` 按 360 天算会静默少覆盖一个月，而数据看起来一条不缺
（docs/DATASET_DESIGN.md §5.6）。
"""

import calendar
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, tzinfo

from platform_server.apps.dataset.formula.errors import FormulaError

_WINDOW_RE = re.compile(
    r"^\s*(\d+)\s*(mo|[smhdwy]|秒|分钟|分|小时|时|天|日|周|月|年)\s*$",
    re.IGNORECASE,
)
# ⚠ `m` → 分钟。历史口径，不许改：改了会让存量公式的窗口长度整体变一个量级
_UNIT_ALIASES = {
    "s": "s",
    "秒": "s",
    "m": "m",
    "分": "m",
    "分钟": "m",
    "h": "h",
    "时": "h",
    "小时": "h",
    "d": "d",
    "天": "d",
    "日": "d",
    "w": "w",
    "周": "w",
    "mo": "mo",
    "月": "mo",
    "y": "y",
    "年": "y",
}
_FIXED_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}
_UNIT_LABELS = {
    "s": "秒",
    "m": "分钟",
    "h": "小时",
    "d": "天",
    "w": "周",
    "mo": "个月",
    "y": "年",
}
# 按日历走的两档
CALENDAR_UNITS = ("mo", "y")
MAX_WINDOW_YEARS = 10
# ⚠ 上限逐单位给、不折成天数：折算会把「正好 10 年」判成超限，因为「一年约
# 366 天」
_UNIT_MAX_AMOUNT = {
    "s": MAX_WINDOW_YEARS * 365 * 86400,
    "m": MAX_WINDOW_YEARS * 365 * 1440,
    "h": MAX_WINDOW_YEARS * 365 * 24,
    "d": MAX_WINDOW_YEARS * 365,
    "w": MAX_WINDOW_YEARS * 52,
    "mo": MAX_WINDOW_YEARS * 12,
    "y": MAX_WINDOW_YEARS,
}
_MONTHS_PER_YEAR = 12


@dataclass(frozen=True)
class WindowSpec:
    """一个时间窗的长度。⚠ 刻意不带「折成多少秒」的属性。"""

    amount: int
    unit: str

    @property
    def literal(self) -> str:
        """规范写法。`'3月'` 与 `'3mo'` 归一到同一个串，缓存键才对得上。"""
        return f"{self.amount}{self.unit}"

    @property
    def label(self) -> str:
        """给人看的写法，如 `3 个月`。"""
        return f"{self.amount} {_UNIT_LABELS[self.unit]}"

    @property
    def is_calendar(self) -> bool:
        """要不要按日历回推。"""
        return self.unit in CALENDAR_UNITS


def parse_window(literal: str) -> WindowSpec:
    """`'1h'` / `'3月'` / `'1年'` → WindowSpec；非法字面量抛 FormulaError。

    Args: literal。
    """
    found = _WINDOW_RE.match(literal or "")
    if found is None:
        raise FormulaError(
            f"时间窗 '{literal}' 非法，应形如 '30s' / '15m' / '1h' / '7d' / "
            "'1w' / '3mo' / '1y'（也可写中文：'3月' / '1年'）"
        )
    amount = int(found.group(1))
    if amount <= 0:
        raise FormulaError("时间窗必须大于 0")
    raw_unit = found.group(2)
    # 只有纯 ASCII 单位要转小写；中文单位原样查表
    unit = _UNIT_ALIASES[raw_unit.lower() if raw_unit.isascii() else raw_unit]
    if amount > _UNIT_MAX_AMOUNT[unit]:
        raise FormulaError(
            f"时间窗 '{literal}' 超过上限（最长 {MAX_WINDOW_YEARS} 年）"
        )
    return WindowSpec(amount=amount, unit=unit)


def window_lower_bound(ts: datetime, spec: WindowSpec, tz: tzinfo) -> datetime:
    """时间窗的下界；窗口是半开区间 `(下界, ts]`，当前行在窗内。

    ⚠ `tz` 没有默认值：月/年要按**业务时区**的日历回推。北京时间 07-01 03:00
    在 UTC 上还是 06-30，按 UTC 字段回推一个月得到 05-31 而不是 06-01——月度
    台账上凭空多出一天，且不报任何错。
    Args: ts, spec, tz（业务时区）。
    """
    if not spec.is_calendar:
        seconds = spec.amount * _FIXED_UNIT_SECONDS[spec.unit]
        return ts - timedelta(seconds=seconds)
    # ⚠ 裸 datetime 按 UTC 读：`astimezone` 会把它当成**机器本地时区**，
    # 同一份代码在开发机与容器里于是算出两个下界
    anchor = ts if ts.tzinfo is not None else ts.replace(tzinfo=UTC)
    months = spec.amount * (_MONTHS_PER_YEAR if spec.unit == "y" else 1)
    # 回推完换回入参原本的时区表示：下界只与 aware 值比较，换算不改变它代表
    # 的那个时刻
    return _minus_months(anchor.astimezone(tz), months).astimezone(
        anchor.tzinfo
    )


def _minus_months(ts: datetime, months: int) -> datetime:
    """按日历往前推 N 个月；目标月没有那一天就取该月最后一天。

    Args: ts, months。
    """
    total = ts.year * _MONTHS_PER_YEAR + (ts.month - 1) - months
    year, month_index = divmod(total, _MONTHS_PER_YEAR)
    month = month_index + 1
    day = min(ts.day, calendar.monthrange(year, month)[1])
    return ts.replace(year=year, month=month, day=day)
