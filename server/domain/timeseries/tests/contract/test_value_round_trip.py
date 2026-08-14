"""锁住写侧与读侧的往返：read_value(*split_value(x)) 必须还原 x。

两侧各写一份编解码就会在这条性质上分叉，而分叉后曲线仍然画得出来。
"""

from datetime import UTC, datetime

import pytest

from timeseries.value import read_value, split_value


@pytest.mark.parametrize(
    "value",
    [
        None,
        0,
        42,
        -3.5,
        10**400,
        "warm",
        "",
        "42",
        '{"a": 1}',
        "出口温度",
        [1, 2, 3],
        ["a", None, 1.5],
        {"unit": "℃", "raw": [1, 2]},
        {},
        [],
    ],
    ids=[
        "空值",
        "零",
        "整数",
        "负小数",
        "超出 float 值域的整数",
        "文本",
        "空串",
        "数字样文本",
        "JSON 样文本",
        "中文",
        "整数数组",
        "混合数组",
        "对象",
        "空对象",
        "空数组",
    ],
)
def test_the_two_columns_round_trip_back_to_the_written_value(
    value: object,
) -> None:
    assert read_value(*split_value(value)) == value


def test_a_boolean_round_trips_as_a_number_so_it_can_be_plotted() -> None:
    assert read_value(*split_value(True)) == 1.0
    assert isinstance(read_value(*split_value(False)), float)


def test_an_integer_round_trips_through_the_numeric_column_as_a_float() -> None:
    assert isinstance(read_value(*split_value(42)), float)


def test_a_numeric_looking_text_stays_text() -> None:
    # ⚠ 文本量不能被读成数值，否则它会混进趋势图并被当成读数聚合
    assert isinstance(read_value(*split_value("42")), str)


def test_an_alien_object_round_trips_as_its_string_form() -> None:
    moment = datetime(2026, 8, 14, 8, 0, tzinfo=UTC)
    assert read_value(*split_value(moment)) == "2026-08-14 08:00:00+00:00"
