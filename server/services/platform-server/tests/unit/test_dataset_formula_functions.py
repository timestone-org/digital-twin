"""每个标量函数的语义与空值行为。

⚠ 贯穿全表的一条口径：**定义域外得空，绝不抛异常**。抛出去会让一行脏数据毁掉
整列，而那一列在界面上看起来只是「算不出来」（docs/DATASET_DESIGN.md §5.5）。
"""

import math

import pytest

from platform_server.apps.dataset.formula import (
    EvalContext,
    FormulaError,
    evaluate,
    parse_formula,
)


def compute(source: str, **values: object) -> object:
    """按给定的一行值算一条公式。

    Args: source, values。
    """
    return evaluate(parse_formula(source), EvalContext(values=dict(values)))


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("ABS(-3)", 3.0),
        ("CEIL(1.2)", 2.0),
        ("FLOOR(1.8)", 1.0),
        ("TRUNC(-2.7)", -2.0),
        ("ROUND(1.234, 2)", 1.23),
        ("ROUND(1.6)", 2.0),
        ("SQRT(9)", 3.0),
        ("POW(2, 10)", 1024.0),
        ("SIGN(-5)", -1.0),
        ("SIGN(0)", 0.0),
        ("CLAMP(120, 0, 100)", 100.0),
        ("HYPOT(3, 4)", 5.0),
    ],
)
def test_the_basic_maths_compute_what_their_names_say(
    source: str, expected: float
) -> None:
    assert compute(source) == expected


def test_the_sign_of_negative_zero_is_zero() -> None:
    # ⚠ `copysign(1.0, -0.0)` 给的是 -1
    assert compute("SIGN(-0.0)") == 0.0


def test_rounding_a_blank_digit_count_reads_as_zero_places() -> None:
    assert compute("ROUND(1.6, {n})", n=None) == 2.0


def test_a_negative_square_root_is_blank_rather_than_an_error() -> None:
    assert compute("SQRT(-1)") is None


@pytest.mark.parametrize(
    "source", ["LN(0)", "LN(-1)", "LOG10(0)", "LOG2(0)", "ASIN(2)", "ACOS(2)"]
)
def test_out_of_domain_calls_are_blank(source: str) -> None:
    assert compute(source) is None


def test_a_one_argument_log_is_the_natural_log() -> None:
    # ⚠ 不猜默认底：Excel 的 LOG 默认 10，工程里的 log 通常指 ln
    assert compute("LOG(E())") == pytest.approx(1.0)


def test_a_two_argument_log_takes_the_base_it_is_given() -> None:
    assert compute("LOG(8, 2)") == pytest.approx(3.0)


@pytest.mark.parametrize("base", ["0", "1", "-2"])
def test_an_undefined_logarithm_base_is_blank(base: str) -> None:
    assert compute(f"LOG(8, {base})") is None


def test_a_blank_base_makes_the_logarithm_blank() -> None:
    assert compute("LOG(8, {b})", b=None) is None


def test_an_overflowing_exponential_is_blank() -> None:
    assert compute("EXP(100000)") is None


def test_the_constants_are_zero_argument_functions() -> None:
    assert compute("PI()") == pytest.approx(math.pi)
    assert compute("E()") == pytest.approx(math.e)


def test_the_trigonometric_family_works_in_radians() -> None:
    assert compute("SIN(RADIANS(90))") == pytest.approx(1.0)
    assert compute("DEGREES(ATAN2(1, 0))") == pytest.approx(90.0)
    assert compute("COS(0)") == pytest.approx(1.0)
    assert compute("TAN(0)") == pytest.approx(0.0)
    assert compute("ATAN(0)") == pytest.approx(0.0)
    assert compute("SINH(0)") == pytest.approx(0.0)
    assert compute("COSH(0)") == pytest.approx(1.0)
    assert compute("TANH(0)") == pytest.approx(0.0)


def test_the_modulus_takes_the_sign_of_the_divisor() -> None:
    # ⚠ 本仓对参考实现的修正：`MOD()` 与中缀 `%` 必须一致，且与电子表格同口径
    assert compute("MOD(-1, 3)") == 2.0
    assert compute("-1 % 3") == 2.0


def test_a_zero_divisor_is_blank_in_both_spellings() -> None:
    assert compute("MOD(1, 0)") is None
    assert compute("1 % 0") is None
    assert compute("1 / 0") is None
    assert compute("1 // 0") is None


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("MIN({a}, {b}, {c})", 1.0),
        ("MAX({a}, {b}, {c})", 3.0),
        ("SUM({a}, {b}, {c})", 4.0),
        ("AVG({a}, {b}, {c})", 2.0),
    ],
)
def test_the_scalar_aggregates_skip_blanks(
    source: str, expected: float
) -> None:
    assert compute(source, a=1, b=None, c=3) == expected


def test_a_scalar_aggregate_over_nothing_but_blanks_is_blank() -> None:
    assert compute("SUM({a}, {b})", a=None, b="  ") is None


def test_the_median_of_an_even_count_averages_the_middle_pair() -> None:
    assert compute("MEDIAN(1, 2, 3, 4)") == 2.5


def test_the_median_of_an_odd_count_is_the_middle_value() -> None:
    assert compute("MEDIAN(3, 1, 2)") == 2.0


def test_the_median_of_nothing_is_blank() -> None:
    assert compute("MEDIAN({a}, {b})", a=None, b=None) is None


def test_the_sample_statistics_need_two_values() -> None:
    assert compute("STDEV(1, {a})", a=None) is None
    assert compute("VAR(1, {a})", a=None) is None


def test_the_population_variance_settles_for_one_value() -> None:
    assert compute("VARP(2)") == 0.0


def test_the_population_variance_of_nothing_is_blank() -> None:
    assert compute("VARP({a}, {b})", a=None, b=None) is None


def test_the_sample_statistics_divide_by_one_less() -> None:
    assert compute("VAR(1, 3)") == 2.0
    assert compute("STDEV(1, 3)") == pytest.approx(math.sqrt(2.0))
    assert compute("VARP(1, 3)") == 1.0


def test_coalesce_returns_the_first_value_that_is_not_null() -> None:
    assert compute("COALESCE({a}, {b}, 0)", a=None, b=5) == 5


def test_coalesce_reads_whitespace_as_a_value_unlike_everywhere_else() -> None:
    # ⚠ 判据是 `is not None` 而不是 `is_blank`：COALESCE 找的是「填过没有」
    assert compute("COALESCE({a}, 9)", a="  ") == "  "


def test_arithmetic_propagates_blanks_instead_of_reading_them_as_zero() -> None:
    # `{进水} - {出水}` 缺一项不等于「等于进水」
    assert compute("{a} - {b}", a=5, b=None) is None


def test_a_type_mismatch_is_a_real_error() -> None:
    with pytest.raises(FormulaError, match="非数字值"):
        compute("{a} - 1", a="abc")


def test_unary_signs_go_through_the_numeric_reading() -> None:
    assert compute("-{a}", a=3) == -3.0
    assert compute("+{a}", a=3) == 3.0
    assert compute("-{a}", a=None) is None


def test_chained_comparison_stops_at_the_first_failing_link() -> None:
    assert compute("0 < {a} < 100", a=5) is True
    assert compute("0 < {a} < 100", a=500) is False


def test_a_blank_anywhere_in_a_chain_makes_it_unknown() -> None:
    assert compute("0 < {a} < 100", a=None) is None


def test_two_strings_compare_lexicographically() -> None:
    assert compute("{a} < {b}", a="abc", b="abd") is True
    assert compute("{a} == {b}", a="x", b="x") is True
    assert compute("{a} != {b}", a="x", b="y") is True


def test_a_string_against_a_number_goes_through_the_numeric_reading() -> None:
    assert compute("{a} >= 2", a="2") is True
    assert compute("{a} <= 2", a="2") is True
    assert compute("{a} > 2", a="3") is True


def test_a_power_that_overflows_is_blank() -> None:
    assert compute("POW(10, 400)") is None
    assert compute("10 ** 400") is None
