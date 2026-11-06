"""API 请求的报告期变量，日期变量按日历偏移后格式化。

语法见 docs/REPORT_TEMPLATE_DESIGN.md。
"""

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

PERIOD_VARIABLES = frozenset({"period", "start", "end", "timezone"})
VARIABLE = re.compile(r"\{\{\s*([^{}]*?)\s*\}\}")
MAX_SHIFT = 1200
MONTHS_PER_YEAR = 12
_DATE = re.compile(
    r"(?P<unit>year|month|day)"
    r"(?:(?P<sign>[+-])(?P<amount>\d{1,4}))?"
    r"(?::(?P<layout>(?:YYYY|MM?|DD?|[-/._年月日])+))?"
)
_LAYOUT_TOKEN = re.compile(r"YYYY|MM?|DD?")
_DEFAULT_LAYOUT = {"year": "YYYY", "month": "MM", "day": "DD"}

type DateUnit = Literal["year", "month", "day"]


@dataclass(frozen=True)
class DateVariable:
    """一个已解析的日期变量。"""

    unit: DateUnit
    shift: int
    layout: str


def parse_date_variable(token: str) -> DateVariable | None:
    """解析 `month-1:YYYY-MM`，不是日期变量时返回 None。Args: token。"""
    match = _DATE.fullmatch(token)
    if match is None:
        return None
    shift = int(match["amount"] or 0)
    if shift > MAX_SHIFT:
        return None
    unit: DateUnit
    match match["unit"]:
        case "year":
            unit = "year"
        case "month":
            unit = "month"
        case _:
            unit = "day"
    return DateVariable(
        unit=unit,
        shift=-shift if match["sign"] == "-" else shift,
        layout=match["layout"] or _DEFAULT_LAYOUT[unit],
    )


def is_known_variable(token: str) -> bool:
    """判断变量名能否被展开。Args: token。"""
    return token in PERIOD_VARIABLES or parse_date_variable(token) is not None


def _shift_months(base: date, months: int) -> date:
    year, index = divmod(
        base.year * MONTHS_PER_YEAR + base.month - 1 + months, 12
    )
    month = index + 1
    return date(year, month, min(base.day, calendar.monthrange(year, month)[1]))


def shifted_date(variable: DateVariable, base: date) -> date:
    """按单位做日历偏移，月末收敛到目标月最后一天。Args: variable, base。"""
    if variable.unit == "day":
        return base + timedelta(days=variable.shift)
    factor = MONTHS_PER_YEAR if variable.unit == "year" else 1
    return _shift_months(base, variable.shift * factor)


def format_date_variable(variable: DateVariable, base: date) -> str:
    """输出偏移后的日期文本。Args: variable, base。"""
    moved = shifted_date(variable, base)
    parts = {
        "YYYY": f"{moved.year:04d}",
        "MM": f"{moved.month:02d}",
        "M": str(moved.month),
        "DD": f"{moved.day:02d}",
        "D": str(moved.day),
    }
    return _LAYOUT_TOKEN.sub(
        lambda found: parts[found.group()], variable.layout
    )
