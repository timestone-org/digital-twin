"""分支与三值逻辑——四件会**静默**出错的事。

1. Kleene 的短路规则：见到决定性取值才提前返回，**未知不中断扫描**；
2. `IF` / `IFS` 比 `AND` / `OR` 严：条件算出空就整条中止，不往下一档滑；
3. `ISBLANK` 是唯一不传染空值的函数；
4. 函数写法与中缀写法必须共用一份实现。

⚠ 第 1 条实现反了的表现是每一条 `OR(ISBLANK({x}), …)` 守卫公式在**它该起作用
的那一档**失效，而且不报错（docs/DATASET_DESIGN.md §5.4）。
"""

import pytest

from platform_server.apps.dataset.formula import (
    SCALAR_FUNCS,
    EvalContext,
    FormulaError,
    evaluate,
    parse_formula,
)
from platform_server.apps.dataset.formula.functions import LAZY_IMPL

# 一颗地雷：只要被求值就必定抛错。用它证明某一支**没有**被求值
LANDMINE = "{雷} - 1"
LANDMINE_VALUES = {"雷": "不是数"}
# 走到这一支就永远算不出数，故没被求值的证据就是「算出来了」
UNKNOWN = "{未知}"
# 只对单个列引用生效的那条守卫要求聚合类至少两个实参
_NEEDS_TWO_ARGS = frozenset(
    {"MIN", "MAX", "SUM", "AVG", "MEDIAN", "STDEV", "VAR", "VARP"}
)


def compute(source: str, **values: object) -> object:
    """按给定的一行值算一条公式。

    Args: source, values。
    """
    merged: dict[str, object] = {"未知": None, **LANDMINE_VALUES, **values}
    return evaluate(parse_formula(source), EvalContext(values=merged))


def test_the_landmine_really_does_explode() -> None:
    # 没有这条，下面每一条「没被求值」的证明都可能只是地雷本身是哑的
    with pytest.raises(FormulaError):
        compute(LANDMINE)


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        ("True", "True", True),
        ("True", "False", False),
        ("True", UNKNOWN, None),
        ("False", "True", False),
        ("False", "False", False),
        ("False", UNKNOWN, False),
        (UNKNOWN, "True", None),
        (UNKNOWN, "False", False),
        (UNKNOWN, UNKNOWN, None),
    ],
)
def test_the_conjunction_truth_table(
    left: str, right: str, expected: bool | None
) -> None:
    assert compute(f"AND({left}, {right})") is expected
    assert compute(f"{left} and {right}") is expected


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        ("True", "True", True),
        ("True", "False", True),
        ("True", UNKNOWN, True),
        ("False", "True", True),
        ("False", "False", False),
        ("False", UNKNOWN, None),
        (UNKNOWN, "True", True),
        (UNKNOWN, "False", None),
        (UNKNOWN, UNKNOWN, None),
    ],
)
def test_the_disjunction_truth_table(
    left: str, right: str, expected: bool | None
) -> None:
    assert compute(f"OR({left}, {right})") is expected
    assert compute(f"{left} or {right}") is expected


def test_the_truth_tables_extend_past_two_operands() -> None:
    assert compute(f"AND({UNKNOWN}, True, False)") is False
    assert compute(f"OR({UNKNOWN}, False, True)") is True


def test_a_conjunction_stops_at_the_first_falsehood() -> None:
    assert compute(f"AND(False, {LANDMINE} > 0)") is False


def test_a_disjunction_stops_at_the_first_truth() -> None:
    assert compute(f"OR(True, {LANDMINE} > 0)") is True


def test_an_unknown_does_not_stop_the_scan() -> None:
    # ⚠ 这一条是整份文件的中心：未知之后的操作数**照样求值**
    with pytest.raises(FormulaError):
        compute(f"AND({UNKNOWN}, {LANDMINE} > 0)")
    with pytest.raises(FormulaError):
        compute(f"OR({UNKNOWN}, {LANDMINE} > 0)")


def test_the_canonical_blank_guard_returns_true_on_a_blank_column() -> None:
    # 写这句话的人要的就是「x 为空时算它成立」
    assert compute("OR(ISBLANK({x}), {x} == 0)", x=None) is True


def test_comparing_a_blank_column_to_zero_is_unknown_not_false() -> None:
    assert compute("{x} == 0", x=None) is None


def test_a_branch_only_evaluates_the_arm_it_takes() -> None:
    assert compute(f"IF(True, 1, {LANDMINE})") == 1
    assert compute(f"IF(False, {LANDMINE}, 2)") == 2


def test_a_multi_branch_only_evaluates_the_arm_it_takes() -> None:
    assert compute(f"IFS(True, 1, True, {LANDMINE}, {LANDMINE})") == 1


def test_a_ternary_only_evaluates_the_arm_it_takes() -> None:
    assert compute(f"1 if True else {LANDMINE}") == 1


def test_a_blank_condition_aborts_the_whole_branch_to_blank() -> None:
    # ⚠ 比 AND / OR 严：「这一档说不准」与「这一档不成立」是两回事
    assert compute(f"IF({UNKNOWN}, 1, 2)") is None
    assert compute(f"1 if {UNKNOWN} else 2") is None


def test_a_blank_condition_stops_a_multi_branch_dead() -> None:
    # ⚠ 不落到下一档，也不落到兜底
    assert compute(f"IFS({UNKNOWN}, 1, True, 2, 3)") is None


def test_a_blank_check_placed_after_a_comparison_is_dead_code() -> None:
    # 推论：判空那一档必须排在任何比较档**之前**
    assert (
        compute("IFS({x} == 0, '零', ISBLANK({x}), '缺数', '正常')", x=None)
        is None
    )
    assert (
        compute("IFS(ISBLANK({x}), '缺数', {x} == 0, '零', '正常')", x=None)
        == "缺数"
    )


def test_the_ternary_and_the_function_form_agree() -> None:
    assert compute("1 if {x} else 2", x=1) == compute("IF({x}, 1, 2)", x=1)
    assert compute("1 if {x} else 2", x=0) == compute("IF({x}, 1, 2)", x=0)


def test_negation_does_not_participate_in_the_three_valued_logic() -> None:
    # ⚠ 把 NOT 接进 Kleene「以求一致」会造出一个建立在未知之上、看着正常的数
    assert compute(f"NOT({UNKNOWN})") is None
    assert compute(f"not {UNKNOWN}") is None
    assert compute("NOT(True)") is False


def test_a_branch_keeps_the_python_type_of_the_value_it_returns() -> None:
    assert compute("IF(True, '文本', 0)") == "文本"
    assert compute("IF(True, True, False)") is True


def test_the_arm_order_decides_which_value_wins() -> None:
    assert compute("IFS({x} > 1, '大', {x} > 0, '小', '零')", x=5) == "大"
    assert compute("IFS({x} > 1, '大', {x} > 0, '小', '零')", x=0.5) == "小"
    assert compute("IFS({x} > 1, '大', {x} > 0, '小', '零')", x=0) == "零"


def test_every_lazy_function_carries_a_laziness_proof() -> None:
    # ⚠ 新加一个惰性函数却没证明它真的惰性，这条会红
    assert set(LAZY_IMPL) == {"IF", "IFS", "AND", "OR"}


def _blank_call(name: str) -> str:
    """按元数下限造一次全空实参的调用。

    Args: name。
    """
    low, _ = SCALAR_FUNCS[name]
    count = max(low, 2) if name in _NEEDS_TWO_ARGS else low
    return f"{name}({', '.join(['{未知}'] * count)})"


@pytest.mark.parametrize(
    "name", sorted(name for name in SCALAR_FUNCS if SCALAR_FUNCS[name][0] > 0)
)
def test_isblank_is_the_only_function_that_does_not_propagate_blank(
    name: str,
) -> None:
    outcome = compute(_blank_call(name))
    if name == "ISBLANK":
        assert outcome is True
    else:
        assert outcome is None
