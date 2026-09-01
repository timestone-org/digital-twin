"""解析器：白名单、引用形态、依赖抽取，以及几处只会静默出错的边界。

⚠ 这里锁的是「哪些写法根本不许进来」。放行一个不该放行的节点，表现不是报错，
而是公式引擎多了一条谁也没设计过的语义。
"""

import ast

import pytest

from platform_server.apps.dataset.formula import (
    FormulaError,
    ParsedFormula,
    PrevRef,
    parse_formula,
)
from platform_server.apps.dataset.formula.parser import collect_arms

# 深到足以打穿 AST 递归栈的表达式
DEEP_NESTING = 400


def deps_of(source: str) -> dict[str, object]:
    """解析一条公式并取它落库的依赖形态。

    Args: source。
    """
    return parse_formula(source).deps.to_json()


def test_a_blank_source_is_rejected() -> None:
    with pytest.raises(FormulaError, match="不能为空"):
        parse_formula("   ")


def test_a_syntax_error_becomes_a_formula_error() -> None:
    with pytest.raises(FormulaError, match="语法错误"):
        parse_formula("{a} +")


def test_deep_nesting_becomes_a_formula_error_not_a_crash() -> None:
    # ⚠ 校验端点只要读权限就能调，不接住 RecursionError 就是白送的 DoS
    with pytest.raises(FormulaError, match="嵌套过深"):
        parse_formula("1" + "+1" * (DEEP_NESTING * 20))


@pytest.mark.parametrize(
    "source",
    [
        "{a}[0]",
        "{a}.real",
        "[{a}]",
        "{{'k': {a}}}",
        "(x for x in [1])",
        "f'{1}'",
        "lambda: 1",
        "{a} is None",
        "{a} in [1]",
        "{a} & 1",
        "(y := 1)",
    ],
)
def test_unsafe_constructs_are_rejected(source: str) -> None:
    with pytest.raises(FormulaError):
        parse_formula(source)


def test_a_bare_identifier_is_rejected() -> None:
    # ⚠ 这条禁令是白名单安全的地基：常量也只能写成 PI() / E()
    with pytest.raises(FormulaError, match="未知标识符"):
        parse_formula("PI")


def test_an_unknown_function_lists_what_is_available() -> None:
    with pytest.raises(FormulaError, match="未知函数 'NOPE'"):
        parse_formula("NOPE(1)")


def test_keyword_arguments_are_rejected() -> None:
    with pytest.raises(FormulaError, match="关键字参数"):
        parse_formula("ROUND({a}, n=2)")


def test_an_attribute_call_is_rejected() -> None:
    with pytest.raises(FormulaError, match="不支持属性调用"):
        parse_formula("math.floor({a})")


def test_an_empty_column_reference_is_rejected() -> None:
    with pytest.raises(FormulaError, match="列名不能为空"):
        parse_formula("{ } + 1")


def test_a_column_key_carrying_a_formula_token_is_rejected() -> None:
    with pytest.raises(FormulaError, match="列标识不能含"):
        parse_formula("{a b} + 1")


def test_the_same_column_referenced_twice_shares_one_dependency() -> None:
    assert deps_of("{a} + {a}")["same_row"] == ["a"]


def test_arithmetic_collects_every_column_it_reads() -> None:
    assert deps_of("{进水} - {出水}")["same_row"] == ["出水", "进水"]


def test_a_string_literal_holding_braces_is_not_a_column_reference() -> None:
    # ⚠ 本仓对参考实现的一处修正：替换先跳过引号跨度
    parsed = parse_formula("IF({a} > 0, '{x}', '')")
    assert sorted(parsed.deps.same_row) == ["a"]


def test_a_string_literal_holding_an_at_sign_is_not_a_library_call() -> None:
    parsed = parse_formula("IF({a} > 0, '@x', '')")
    assert sorted(parsed.deps.same_row) == ["a"]


def test_a_bare_at_sign_points_at_the_missing_parentheses() -> None:
    with pytest.raises(FormulaError, match="调用库公式要带括号"):
        parse_formula("@某公式 + 1")


def test_prev_defaults_to_one_step_back() -> None:
    assert parse_formula("PREV({a})").deps.prev == {PrevRef(key="a", steps=1)}


def test_prev_takes_an_integer_literal_and_rejects_a_boolean() -> None:
    # `PREV({a}, True)` 在 Python 里就是 `PREV({a}, 1)`，而用户写的是别的意思
    with pytest.raises(FormulaError, match="正整数字面量"):
        parse_formula("PREV({a}, True)")


def test_prev_rejects_an_expression_as_its_step_count() -> None:
    with pytest.raises(FormulaError, match="正整数字面量"):
        parse_formula("PREV({a}, {b})")


@pytest.mark.parametrize("steps", [0, 101])
def test_prev_bounds_its_step_count(steps: int) -> None:
    with pytest.raises(FormulaError, match=r"1\.\.100"):
        parse_formula(f"PREV({{a}}, {steps})")


def test_prev_rejects_a_cross_table_column() -> None:
    # 「上一条」要先确定站在对方表的哪一行上
    with pytest.raises(FormulaError, match="PREV"):
        parse_formula("PREV({other.a})")


def test_prev_needs_a_bare_column_reference() -> None:
    with pytest.raises(FormulaError, match="必须是列引用"):
        parse_formula("PREV({a} + 1)")


def test_a_window_call_needs_exactly_a_column_and_a_literal() -> None:
    with pytest.raises(FormulaError, match="SUM_OVER 用法"):
        parse_formula("SUM_OVER({a})")


def test_a_window_length_must_be_a_string_literal() -> None:
    with pytest.raises(FormulaError, match="字符串字面量"):
        parse_formula("SUM_OVER({a}, {b})")


def test_a_whole_column_call_takes_exactly_one_column() -> None:
    with pytest.raises(FormulaError, match="MIN_ALL 用法"):
        parse_formula("MIN_ALL({a}, {b})")


def test_the_column_argument_of_a_window_never_enters_the_same_row_set() -> (
    None
):
    # ⚠ 正是这一点让 `SUM_OVER({自己}, '1y')` 不被判成自环
    parsed = parse_formula("SUM_OVER({累计}, '1y')")
    assert parsed.deps.same_row == set()
    assert parsed.deps.referenced_keys == {"累计"}


def test_a_cross_table_reference_never_enters_the_same_row_set() -> None:
    # ⚠ 表 code 是 ASCII 标识（`TableCode`），列 key 才放行中文
    parsed = parse_formula("{output.产量} * 0.9")
    assert parsed.deps.same_row == set()
    assert parsed.deps.external_table_codes == {"output"}


def test_a_cross_table_reference_is_excluded_from_the_known_column_check() -> (
    None
):
    parsed = parse_formula("{energy} + {other.x}", {"energy"})
    assert parsed.deps.referenced_keys == {"energy"}


def test_an_unknown_column_names_itself() -> None:
    with pytest.raises(FormulaError, match="引用了不存在的列：乙"):
        parse_formula("{甲} + {乙}", {"甲"})


def test_a_cross_table_column_key_is_still_validated() -> None:
    with pytest.raises(FormulaError, match="跨表引用"):
        parse_formula("{other.a b} + 1")


def test_ifs_demands_an_odd_argument_count() -> None:
    # 缺兜底时「所有条件都不成立取什么值」没有答案，而那一档最难在界面上看出来
    with pytest.raises(FormulaError, match="必须是奇数"):
        parse_formula("IFS({a} > 0, 1, {b} > 0, 2)")


def test_arity_errors_name_the_expected_range() -> None:
    with pytest.raises(FormulaError, match=r"ABS 需要 1 个参数，实际 2 个"):
        parse_formula("ABS(1, 2)")


def test_an_unbounded_arity_reads_as_a_range() -> None:
    with pytest.raises(FormulaError, match=r"1~不限"):
        parse_formula("SUM()")


@pytest.mark.parametrize(
    ("source", "hint"),
    [
        ("MIN({值})", "MIN_ALL"),
        ("MAX({值})", "MAX_ALL"),
        ("SUM({值})", "SUM_ALL"),
        ("AVG({值})", "AVG_ALL"),
    ],
)
def test_a_scalar_aggregate_over_one_column_points_at_the_whole_column_form(
    source: str, hint: str
) -> None:
    # ⚠ 放行的话极差标准化会退化成 0/0，整列算空且不报错
    with pytest.raises(FormulaError, match=hint):
        parse_formula(source)


@pytest.mark.parametrize("name", ["MEDIAN", "STDEV", "VAR", "VARP"])
def test_a_statistic_over_one_column_asks_for_more_values(name: str) -> None:
    # 这几个没有整列变体，所以指的是「多给几个值」而不是某个函数
    with pytest.raises(FormulaError, match="请把要一起统计的几列都列进来"):
        parse_formula(f"{name}({{值}})")


@pytest.mark.parametrize("source", ["MIN({a}, {b})", "MIN(5)", "MIN({a} + 1)"])
def test_the_single_column_guard_only_fires_on_a_bare_single_reference(
    source: str,
) -> None:
    assert isinstance(parse_formula(source), ParsedFormula)


def test_the_persisted_dependency_shape_is_deterministically_sorted() -> None:
    first = deps_of("SUM_OVER({b}, '1h') + SUM_OVER({a}, '1h')")
    second = deps_of("SUM_OVER({a}, '1h') + SUM_OVER({b}, '1h')")
    assert first == second


def test_every_reference_kind_lands_in_its_own_bucket() -> None:
    parsed = parse_formula(
        "IFS(ALL_ZERO_OVER({产量}, '12mo'), 0, ISBLANK({产量}), 0, "
        "{能耗} / {产量} - PREV({能耗}) / AVG_ALL({能耗}) "
        "+ {out.基准} * SUM_OVER({out.产量}, '3月'))"
    )
    assert parsed.deps.to_json() == {
        "model": [],
        "same_row": ["产量", "能耗"],
        "prev": [{"key": "能耗", "steps": 1}],
        "window": [
            {"func": "ALL_ZERO_OVER", "key": "产量", "window": "12mo"},
            {"func": "SUM_OVER", "key": "out.产量", "window": "3mo"},
        ],
        "whole": [{"func": "AVG_ALL", "key": "能耗"}],
        "external": [{"table": "out", "key": "基准"}],
        "referenced_keys": ["产量", "能耗"],
    }


def test_the_parsed_tree_is_a_real_python_expression() -> None:
    # 借的是 CPython 的语法，故优先级与结合性不必再自证一遍
    assert isinstance(parse_formula("{a} + 1").tree, ast.Expression)


def test_collect_arms_flattens_only_the_otherwise_slot() -> None:
    tree = parse_formula("IF({a}, IF({b}, 1, 2), 3)").tree
    arms: list[tuple[ast.expr, ast.expr]] = []
    otherwise = collect_arms(tree.body, arms)
    assert len(arms) == 1
    assert isinstance(otherwise, ast.Constant)


def test_collect_arms_returns_its_input_when_there_is_nothing_to_flatten() -> (
    None
):
    tree = parse_formula("{a} + 1").tree
    arms: list[tuple[ast.expr, ast.expr]] = []
    assert collect_arms(tree.body, arms) is tree.body
    assert arms == []
