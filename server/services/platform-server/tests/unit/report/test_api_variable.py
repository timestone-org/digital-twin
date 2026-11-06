"""日期变量的解析、日历偏移与格式化。"""

from datetime import date

import pytest
from pydantic import ValidationError
from unit.report.api_source_fakes import source

from platform_server.apps.report.schemas.api_variable import (
    format_date_variable,
    is_known_variable,
    parse_date_variable,
)


def render(token: str, base: date) -> str:
    variable = parse_date_variable(token)
    assert variable is not None
    return format_date_variable(variable, base)


@pytest.mark.parametrize(
    ("token", "base", "expected"),
    [
        ("year", date(2026, 11, 6), "2026"),
        ("month", date(2026, 1, 6), "01"),
        ("day", date(2026, 11, 6), "06"),
        ("year-1", date(2026, 11, 6), "2025"),
        ("month-1", date(2026, 1, 6), "12"),
        ("month-1:YYYY", date(2026, 1, 6), "2025"),
        ("month-1:YYYY-MM", date(2026, 1, 6), "2025-12"),
        ("month+1:YYYY-MM", date(2026, 12, 6), "2027-01"),
        ("month-13:YYYY-MM", date(2026, 1, 6), "2024-12"),
        ("day-1:YYYY-MM-DD", date(2026, 1, 1), "2025-12-31"),
        ("day-1", date(2026, 3, 1), "28"),
        ("month-1:YYYY-MM-DD", date(2026, 3, 31), "2026-02-28"),
        ("year-1:YYYY-MM-DD", date(2024, 2, 29), "2023-02-28"),
        ("month:YYYY年M月", date(2026, 1, 6), "2026年1月"),
        ("day:M/D", date(2026, 1, 6), "1/6"),
    ],
)
def test_calendar_shift_and_layout(token, base, expected):
    assert render(token, base) == expected


@pytest.mark.parametrize(
    "token",
    [
        "quarter",
        "year-",
        "year-a",
        "year+1201",
        "month:HH",
        "month:YY",
        "day -1",
        "",
    ],
)
def test_unknown_variables_are_rejected(token):
    assert not is_known_variable(token)


@pytest.mark.parametrize("token", ["period", "start", "end", "timezone"])
def test_period_variables_stay_known(token):
    assert is_known_variable(token)


def test_template_save_rejects_unknown_variable_in_path_and_query():
    with pytest.raises(ValidationError, match="报告期变量"):
        source(path="/report/{{week}}")
    with pytest.raises(ValidationError, match="报告期变量"):
        source(query={"m": "{{month-x}}"})


def test_template_save_accepts_date_variables_with_spaces():
    wanted = source(query={"m": "{{ month-1:YYYY-MM }}"})

    assert wanted.query == {"m": "{{ month-1:YYYY-MM }}"}
