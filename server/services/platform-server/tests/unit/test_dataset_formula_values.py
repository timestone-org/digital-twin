"""值模型：空、数、真假只有一份定义，且三者互相自洽。

⚠ 这份自洽是承重的：`is_blank` 与 `truthy` 分成两套的话，同一行数据上
`IF({开关}, …)` 会走真支、而 `{开关} == 0` 也判真
（docs/DATASET_DESIGN.md §5.2）。
"""

import math

import pytest

from platform_server.apps.dataset.formula import FormulaError
from platform_server.apps.dataset.formula.values import (
    finite_constant,
    is_blank,
    numbers_of,
    to_number,
    truthy,
)

# 401 位整数：`float()` 抛的是 OverflowError 而不是 ValueError
OVERSIZED_NUMBER = int("9" * 401)


@pytest.mark.parametrize("value", [None, "", "   ", "\t\n"])
def test_none_and_whitespace_only_text_are_blank(value: object) -> None:
    assert is_blank(value) is True


@pytest.mark.parametrize("value", [0, 0.0, False, "0", "abc"])
def test_zero_and_false_are_not_blank(value: object) -> None:
    # ⚠ 0 是一个断言（「这一小时用电为零」），空是「算不出来」
    assert is_blank(value) is False


def test_a_blank_reads_as_no_number() -> None:
    assert to_number(None) is None
    assert to_number("  ") is None


def test_booleans_read_as_one_and_zero() -> None:
    assert to_number(True) == 1.0
    assert to_number(False) == 0.0


def test_text_is_stripped_before_being_read_as_a_number() -> None:
    assert to_number(" 2.5 ") == 2.5


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_numbers_read_as_blank_rather_than_erroring(
    value: float,
) -> None:
    # 放行的话它会一路算进 computed_json，而 PG 的 jsonb 拒收 NaN/Infinity
    assert to_number(value) is None


@pytest.mark.parametrize("value", ["nan", "inf", "-inf"])
def test_non_finite_text_reads_as_blank_too(value: str) -> None:
    assert to_number(value) is None


def test_unconvertible_text_is_an_error_in_an_arithmetic_slot() -> None:
    with pytest.raises(FormulaError, match="非数字值"):
        to_number("停机")


def test_an_unsupported_type_is_an_error() -> None:
    with pytest.raises(FormulaError, match="不支持的值类型"):
        to_number([1, 2])


def test_an_oversized_integer_is_a_formula_error_not_an_overflow() -> None:
    # ⚠ float() 抛的是 OverflowError，漏接就穿透成 500
    with pytest.raises(FormulaError, match="超出可表示范围"):
        to_number(OVERSIZED_NUMBER)


def test_an_oversized_literal_is_rejected_at_the_boundary() -> None:
    with pytest.raises(FormulaError, match="超出可表示范围"):
        finite_constant(OVERSIZED_NUMBER)


def test_an_infinite_literal_is_rejected_at_the_boundary() -> None:
    # `1e400` 落库会产出 jsonb 拒收的 Infinity，整表写入就此永久失败
    with pytest.raises(FormulaError, match="超出可表示范围"):
        finite_constant(math.inf)


@pytest.mark.parametrize("value", [True, "文本", None, 3, 2.5])
def test_ordinary_literals_pass_through_untouched(value: object) -> None:
    assert finite_constant(value) is value


def test_blank_reads_as_unknown_in_a_condition_slot() -> None:
    assert truthy(None) is None
    assert truthy("   ") is None


def test_zero_reads_as_false_and_any_other_number_as_true() -> None:
    assert truthy(0) is False
    assert truthy(0.0) is False
    assert truthy(-1) is True


def test_the_string_zero_reads_as_false_because_text_goes_numeric_first() -> (
    None
):
    # ⚠ 与 `{开关} == 0` 同一套口径，两句话不会互相矛盾
    assert truthy("0") is False


def test_unparseable_text_reads_as_true_and_never_raises() -> None:
    # 一格脏数据不该废掉整列
    assert truthy("停机") is True


@pytest.mark.parametrize("value", ["nan", "inf"])
def test_non_finite_text_reads_as_unknown_in_a_condition_slot(
    value: str,
) -> None:
    assert truthy(value) is None


def test_booleans_read_as_themselves() -> None:
    assert truthy(True) is True
    assert truthy(False) is False


def test_a_non_scalar_value_falls_back_to_python_truthiness() -> None:
    assert truthy([1]) is True
    assert truthy([]) is False


def test_scalar_aggregation_skips_blanks_but_keeps_zero() -> None:
    assert numbers_of([1, None, "  ", 0, "2"], "SUM") == [1.0, 0.0, 2.0]
