"""锁住归档两列的编解码：布尔量进数值列、其余进 JSON 文本列、0.0 不当空值。"""

from datetime import UTC, datetime

import pytest

from timeseries.value import read_value, split_value


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (True, (1.0, None)),
        (False, (0.0, None)),
        (42, (42.0, None)),
        (0, (0.0, None)),
        (-3.5, (-3.5, None)),
    ],
    ids=["真", "假", "整数", "零", "负小数"],
)
def test_split_puts_numbers_and_booleans_in_the_numeric_column(
    value: object, expected: tuple[float | None, str | None]
) -> None:
    assert split_value(value) == expected


def test_split_leaves_both_columns_empty_for_a_missing_reading() -> None:
    assert split_value(None) == (None, None)


@pytest.mark.parametrize(
    ("value", "expected_text"),
    [
        ("warm", '"warm"'),
        ("", '""'),
        ("42", '"42"'),
        ([1, "a"], '[1, "a"]'),
        ({"unit": "℃"}, '{"unit": "℃"}'),
    ],
    ids=["文本", "空串", "数字样文本", "数组", "对象"],
)
def test_split_encodes_everything_else_as_json_text(
    value: object, expected_text: str
) -> None:
    assert split_value(value) == (None, expected_text)


def test_split_keeps_non_ascii_text_unescaped() -> None:
    assert split_value("出口温度") == (None, '"出口温度"')


def test_split_falls_back_to_the_string_form_of_an_alien_object() -> None:
    moment = datetime(2026, 8, 14, 8, 0, tzinfo=UTC)
    assert split_value(moment) == (None, '"2026-08-14 08:00:00+00:00"')


def test_read_prefers_the_numeric_column() -> None:
    assert read_value(3.5, '"stale"') == 3.5


def test_read_keeps_zero_as_a_reading() -> None:
    # ⚠ 判真假会让 0.0 掉进文本分支，读出一个陈旧的字符串
    assert read_value(0.0, '"stale"') == 0.0


def test_read_yields_none_when_both_columns_are_empty() -> None:
    assert read_value(None, None) is None


@pytest.mark.parametrize(
    ("value_text", "expected"),
    [
        ('"warm"', "warm"),
        ("[1, 2]", [1, 2]),
        ('{"unit": "℃"}', {"unit": "℃"}),
        ("true", True),
        ("null", None),
    ],
    ids=["文本", "数组", "对象", "布尔", "空"],
)
def test_read_decodes_the_text_column_as_json(
    value_text: str, expected: object
) -> None:
    assert read_value(None, value_text) == expected


@pytest.mark.parametrize(
    "value_text",
    ["", "not json at all", "{"],
    ids=["空串", "散文", "半截 JSON"],
)
def test_read_returns_undecodable_text_verbatim(value_text: str) -> None:
    assert read_value(None, value_text) == value_text
