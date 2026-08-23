"""记号树：把公式画成人读的数学式，且**认不出来就降级，绝不抛**。

⚠ 两条最贵的：分段渲染**不设档数上限**（截断会画出一条与落库公式不一样的算式，
而且会让递归在同一个节点上原地打转 → 500），以及布尔与空值必须带 `raw`
（没有它，`None` 回写成字符串 `'空'`，而非空字符串恒为真，语义正好反过来）。
"""

from typing import Any

import pytest

from platform_server.apps.dataset.formula import (
    ColumnLabel,
    FormulaError,
    NotationNode,
    TableLabels,
    parse_formula,
    to_notation,
    to_plain_text,
)
from platform_server.apps.dataset.formula.notation import _Builder

LABELS = {
    "进水": ColumnLabel(name="进水量", unit="m³"),
    "出水": ColumnLabel(name="出水量", unit="m³"),
}
TABLES = {
    "src": TableLabels(name="产量表", columns={"产量": ColumnLabel("日产量")})
}
# 远多于任何一份「界面上读得动」的档数上限
MANY_ARMS = 120


def tree_of(source: str) -> NotationNode:
    """渲染一条公式的记号树。

    Args: source。
    """
    return to_notation(parse_formula(source), LABELS, TABLES)


def text_of(source: str) -> str:
    """渲染一条公式的一行读法。

    Args: source。
    """
    return to_plain_text(tree_of(source))


def test_a_column_renders_as_its_display_name() -> None:
    assert tree_of("{进水}") == {
        "t": "col",
        "name": "进水量",
        "unit": "m³",
        "key": "进水",
    }


def test_a_column_without_metadata_falls_back_to_its_key() -> None:
    assert tree_of("{未登记}") == {
        "t": "col",
        "name": "未登记",
        "unit": None,
        "key": "未登记",
    }


def test_a_cross_table_column_shows_which_table_it_came_from() -> None:
    assert tree_of("{src.产量}") == {
        "t": "ext",
        "table": "产量表",
        "table_code": "src",
        "name": "日产量",
        "unit": None,
        "key": "产量",
    }
    assert text_of("{src.产量}") == "产量表·日产量"


def test_an_unlabelled_cross_table_column_falls_back_to_its_codes() -> None:
    assert text_of("{other.x}") == "other·x"


def test_division_becomes_a_fraction_rather_than_a_binary_operator() -> None:
    assert tree_of("{进水} / {出水}")["t"] == "frac"


def test_arithmetic_uses_typographic_symbols() -> None:
    assert tree_of("{进水} - {出水}")["op"] == "−"
    assert tree_of("{进水} * {出水}")["op"] == "×"
    assert tree_of("{进水} % {出水}")["op"] == "mod"
    assert tree_of("{进水} // {出水}")["op"] == "÷"


def test_comparisons_use_typographic_symbols() -> None:
    assert tree_of("{进水} != 1")["op"] == "≠"
    assert tree_of("{进水} <= 1")["op"] == "≤"
    assert tree_of("{进水} >= 1")["op"] == "≥"
    assert tree_of("{进水} == 1")["op"] == "="


def test_a_chained_comparison_flattens_into_a_conjunction() -> None:
    node = tree_of("0 < {进水} < 10")
    assert node["t"] == "logic"
    assert node["op"] == "且"
    assert len(node["args"]) == 2


def test_both_spellings_of_a_power_draw_the_same_node() -> None:
    assert tree_of("{进水} ** 2")["t"] == "pow"
    assert tree_of("POW({进水}, 2)")["t"] == "pow"


def test_a_square_root_gets_its_own_node() -> None:
    assert tree_of("SQRT({进水})")["t"] == "sqrt"


def test_a_scalar_function_carries_a_chinese_label() -> None:
    node = tree_of("ABS({进水})")
    assert (node["t"], node["name"], node["label"]) == ("fn", "ABS", "绝对值")


def test_an_unlabelled_function_falls_back_to_its_name() -> None:
    assert tree_of("COALESCE({进水}, 0)")["label"] == "取第一个非空"


def test_a_window_aggregate_shows_the_span_it_covers() -> None:
    node = tree_of("SUM_OVER({进水}, '3月')")
    assert node["t"] == "agg"
    assert node["sym"] == "Σ"
    assert node["label"] == "近 3 个月"
    # func / window 只给回写公式文本用
    assert node["func"] == "SUM_OVER"
    assert node["window"] == "3mo"


def test_a_whole_column_aggregate_says_whole_table() -> None:
    node = tree_of("SUM_ALL({进水})")
    assert (node["label"], node["window"]) == ("全表", None)


def test_a_cross_row_reference_says_how_far_back_it_reaches() -> None:
    assert text_of("PREV({进水})") == "上一条的 进水量"
    assert text_of("PREV({进水}, 3)") == "上一条的 进水量 第3条"


def test_a_negation_and_a_logical_not_get_different_nodes() -> None:
    assert tree_of("-{进水}")["t"] == "neg"
    assert tree_of("not {进水}")["t"] == "not"


def test_a_unary_plus_is_passed_through() -> None:
    assert tree_of("+{进水}")["t"] == "col"


def test_a_number_that_is_whole_loses_its_decimal_tail() -> None:
    assert tree_of("3600.0")["v"] == "3600"
    assert tree_of("1.5")["v"] == "1.5"


def test_a_string_literal_renders_as_itself() -> None:
    assert tree_of("'停机'") == {"t": "text", "v": "停机"}


@pytest.mark.parametrize(
    ("source", "shown", "raw"),
    [("True", "是", True), ("False", "否", False), ("None", "空", None)],
)
def test_booleans_and_blanks_carry_the_raw_value_they_render(
    source: str, shown: str, raw: object
) -> None:
    # ⚠ 没有 raw，回写时 `None` 就成了字符串 `'空'`——非空字符串恒为真，
    # 分支逻辑正好反过来，且不报任何错
    node = tree_of(source)
    assert node["v"] == shown
    assert node["raw"] is raw


def test_a_single_branch_renders_as_one_arm() -> None:
    node = tree_of("IF({进水} > 1, 1, 0)")
    assert node["t"] == "cases"
    assert len(node["arms"]) == 1
    assert node["arms"][0]["t"] == "arm"


def test_nested_branches_in_the_otherwise_slot_flatten_into_parallel_arms() -> (
    None
):
    node = tree_of("IF({进水} > 2, 2, IF({进水} > 1, 1, 0))")
    assert len(node["arms"]) == 2


def test_a_branch_nested_in_a_value_slot_stays_nested() -> None:
    # ⚠ 摊平只发生在「否则」位：`IF(a, IF(b,1,2), 3)` 摊成三档并列会把该算 2
    # 的算成 3
    node = tree_of("IF({进水} > 1, IF({出水} > 1, 1, 2), 3)")
    assert len(node["arms"]) == 1
    assert node["arms"][0]["then"]["t"] == "cases"


def test_the_ternary_renders_as_a_piecewise_function_too() -> None:
    assert tree_of("1 if {进水} else 0")["t"] == "cases"


def test_the_renderer_is_never_capped_by_an_arm_count() -> None:
    # ⚠ 截断会画出一条与落库公式不一样的算式；更糟的是 `collect_arms` 摊不动时
    # 原样退回入参，继续递归就在同一个节点上原地打转 → RecursionError → 详情页
    # 与校验端点一起永久 500
    arms = ", ".join(
        f"{{进水}} > {index}, {index}" for index in range(MANY_ARMS)
    )
    node = tree_of(f"IFS({arms}, 0)")
    assert len(node["arms"]) == MANY_ARMS


def test_an_unflattenable_branch_reports_rather_than_spinning() -> None:
    parsed = parse_formula("{进水} + 1")
    builder = _Builder(parsed, LABELS, TABLES)
    with pytest.raises(FormulaError, match="摊不开"):
        builder._cases(parsed.tree.body)


def test_precedence_inserts_the_parentheses_the_maths_needs() -> None:
    assert text_of("({进水} + {出水}) * 2") == "(进水量 + 出水量) × 2"
    assert text_of("{进水} + {出水} * 2") == "进水量 + 出水量 × 2"


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("({进水} and {出水}) + 1", "(进水量 且 出水量) + 1"),
        ("(-{进水}) ** 2", "(−进水量)^2"),
        ("{进水} ** 2 * 3", "进水量^2 × 3"),
        ("(not {进水}) + 1", "(非 进水量) + 1"),
        ("({进水} > 1) == True", "(进水量 > 1) = 是"),
    ],
)
def test_every_node_kind_knows_when_it_needs_parentheses(
    source: str, expected: str
) -> None:
    assert text_of(source) == expected


def test_a_subtraction_on_the_right_keeps_its_grouping() -> None:
    assert text_of("{进水} - ({出水} - 1)") == "进水量 − (出水量 − 1)"


def test_a_branch_is_parenthesised_in_linear_text() -> None:
    # ⚠ 不加括号会念成「…否则 0 + 3」，`+3` 看着挂在兜底那一档上
    assert text_of("IF({进水} > 1, 1, 0) + 3").startswith("(若 ")


def test_the_worked_example_reads_as_one_line_of_chinese() -> None:
    assert (
        text_of("IF(ISBLANK({进水}), 0, {出水} / {进水} * 100)")
        == "若 是否为空(进水量) 则 0，否则 出水量 ÷ 进水量 × 100"
    )


@pytest.mark.parametrize(
    "node",
    [
        {"t": "没这个类型"},
        {},
        {"t": "col"},
        {"t": "bin", "op": "+"},
        {"t": "cases", "arms": [{"t": "arm"}], "else": {"t": "num", "v": "1"}},
    ],
)
def test_an_unreadable_node_degrades_to_a_placeholder(
    node: dict[str, Any],
) -> None:
    # ⚠ 一个能识别的节点少了个子字段就会让递归撞上缺键，把整个弹窗打黑
    assert "?" in to_plain_text(node)
