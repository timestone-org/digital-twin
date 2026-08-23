"""库公式展开：`@标识(实参)` 就地内联成引擎原生的节点。

⚠ 本期没有公式库那张表（随第 4 期落地），只有这道缝：引擎照常认得调用、照常
展开，快照由调用方给。这里用内存里搭出来的快照把语义钉住，第 4 期只补持久化。
⚠ 全篇最贵的一条：**替换的是 AST 子树不是文本**。文本替换「看起来能用」，而
它按运算符优先级是错的，且不报错、数还长得挺像样。
"""

import pytest

from platform_server.apps.dataset.formula import (
    EMPTY_LIBRARY,
    EvalContext,
    FormulaError,
    FormulaLibrary,
    FxEntry,
    FxParam,
    evaluate,
    parse_formula,
)
from platform_server.apps.dataset.formula.library import (
    MAX_FX_DEPTH,
    PARAM_VALUE,
)

SHARE = FxEntry(
    code="占比",
    name="占比",
    expression="{部分} / {整体} * 100",
    params=(FxParam(name="部分"), FxParam(name="整体")),
)


def library(*entries: FxEntry) -> FormulaLibrary:
    """按若干条目搭一份快照。

    Args: entries。
    """
    return FormulaLibrary.of(list(entries))


def compute(source: str, snapshot: FormulaLibrary, **values: object) -> object:
    """在一份库快照下算一条公式。

    Args: source, snapshot, values。
    """
    parsed = parse_formula(source, library=snapshot)
    return evaluate(parsed, EvalContext(values=dict(values)))


def test_the_library_is_empty_until_it_is_populated() -> None:
    assert bool(EMPTY_LIBRARY) is False
    assert EMPTY_LIBRARY.enabled_entries() == []


def test_calling_into_an_empty_library_says_so() -> None:
    # ⚠ 不说成「没有这条公式」：库还没建与库里缺一条，处置方式不同
    with pytest.raises(FormulaError, match="公式库当前是空的"):
        parse_formula("@占比({a}, {b})")


def test_an_unknown_code_lists_what_is_available() -> None:
    with pytest.raises(FormulaError, match="可用：占比"):
        parse_formula("@没有({a})", library=library(SHARE))


def test_a_disabled_entry_says_disabled_rather_than_missing() -> None:
    # ⚠ 说成「库里没有 X」会把人送去建一条已经存在的公式
    snapshot = library(
        FxEntry(code="停", name="停", expression="1", is_enabled=False)
    )
    with pytest.raises(FormulaError, match="已停用"):
        parse_formula("@停()", library=snapshot)


def test_a_disabled_entry_is_still_in_the_snapshot() -> None:
    snapshot = library(
        FxEntry(code="停", name="停", expression="1", is_enabled=False)
    )
    assert snapshot.get("停") is not None
    assert snapshot.enabled_entries() == []


def test_an_expansion_yields_the_same_dependencies_as_typing_it_inline() -> (
    None
):
    expanded = parse_formula("@占比({能耗}, {产量})", library=library(SHARE))
    inline = parse_formula("{能耗} / {产量} * 100")
    assert expanded.deps.to_json() == inline.deps.to_json()


def test_the_expanded_call_computes_what_the_body_says() -> None:
    assert compute("@占比({a}, {b})", library(SHARE), a=1, b=4) == 25.0


def test_substitution_splices_a_subtree_rather_than_text() -> None:
    # ⚠ 文本替换会把 `{部分}/{整体}*100` 算成 `1/1+3*100 = 301`，正确答案是 25
    entry = FxEntry(
        code="占比",
        name="占比",
        expression="{部分} / {整体} * 100",
        params=(
            FxParam(name="部分", kind=PARAM_VALUE),
            FxParam(name="整体", kind=PARAM_VALUE),
        ),
    )
    assert compute("@占比(1, 1 + 3)", library(entry)) == 25.0


def test_a_parameter_used_twice_gets_two_independent_copies() -> None:
    entry = FxEntry(
        code="平方",
        name="平方",
        expression="{x} * {x}",
        params=(FxParam(name="x"),),
    )
    assert compute("@平方({a})", library(entry), a=3) == 9.0


def test_the_signature_shows_up_in_the_arity_error() -> None:
    with pytest.raises(FormulaError, match=r"@占比\(部分, 整体\) 需要 2 个"):
        parse_formula("@占比({a})", library=library(SHARE))


def test_a_column_parameter_refuses_an_expression() -> None:
    # `PREV` / `*_OVER` / `*_ALL` 要知道是**哪一列**，收不了算式
    with pytest.raises(FormulaError, match="必须是列引用"):
        parse_formula("@占比({a} + 1, {b})", library=library(SHARE))


def test_a_value_parameter_accepts_an_expression() -> None:
    entry = FxEntry(
        code="加",
        name="加",
        expression="{x} + 1",
        params=(FxParam(name="x", kind=PARAM_VALUE),),
    )
    assert compute("@加(2 * 3)", library(entry)) == 7.0


def test_keyword_arguments_are_refused_at_a_library_call_too() -> None:
    entry = FxEntry(code="零", name="零", expression="0")
    with pytest.raises(FormulaError, match="关键字参数"):
        parse_formula("@零(x=1)", library=library(entry))


def test_a_zero_parameter_call_still_needs_its_parentheses() -> None:
    entry = FxEntry(code="零", name="零", expression="0")
    assert compute("@零() + 1", library(entry)) == 1.0


def test_nesting_composes() -> None:
    inner = FxEntry(
        code="翻倍", name="翻倍", expression="{x} * 2", params=(FxParam("x"),)
    )
    outer = FxEntry(
        code="四倍",
        name="四倍",
        expression="@翻倍({x}) * 2",
        params=(FxParam("x"),),
    )
    assert compute("@四倍({a})", library(inner, outer), a=3) == 12.0


def test_a_nested_call_in_argument_position_is_not_a_cycle() -> None:
    # 实参属于**调用方**，用调用方的调用链展开
    entry = FxEntry(
        code="加一",
        name="加一",
        expression="{x} + 1",
        params=(FxParam(name="x", kind=PARAM_VALUE),),
    )
    assert compute("@加一(@加一(1))", library(entry)) == 3.0


def test_library_formulas_calling_each_other_in_a_ring_are_rejected() -> None:
    first = FxEntry(code="甲", name="甲", expression="@乙()")
    second = FxEntry(code="乙", name="乙", expression="@甲()")
    with pytest.raises(FormulaError, match="互相调用成环：甲 → 乙 → 甲"):
        parse_formula("@甲()", library=library(first, second))


def test_nesting_deeper_than_the_cap_is_rejected() -> None:
    depth = MAX_FX_DEPTH + 2
    entries = [
        FxEntry(
            code=f"层{index}",
            name=f"层{index}",
            expression=f"@层{index + 1}()" if index < depth else "1",
        )
        for index in range(depth + 1)
    ]
    with pytest.raises(FormulaError, match="嵌套超过"):
        parse_formula("@层0()", library=library(*entries))


def test_a_body_that_will_not_parse_names_the_library_formula() -> None:
    entry = FxEntry(code="坏", name="坏", expression="1 +")
    with pytest.raises(FormulaError, match="库公式 '坏' 有误"):
        parse_formula("@坏()", library=library(entry))


def test_the_codes_that_were_touched_are_reported_for_reverse_lookup() -> None:
    inner = FxEntry(code="翻倍", name="翻倍", expression="2 * 2")
    outer = FxEntry(code="四倍", name="四倍", expression="@翻倍() * 2")
    parsed = parse_formula("@四倍()", library=library(inner, outer))
    assert parsed.used_fx == frozenset({"四倍", "翻倍"})


def test_a_body_may_reference_another_table_absolutely() -> None:
    entry = FxEntry(code="基准", name="基准", expression="{src.基准} * 2")
    parsed = parse_formula("@基准()", library=library(entry))
    assert parsed.deps.external_table_codes == {"src"}


def test_a_body_reusing_a_reference_the_caller_already_made_shares_it() -> None:
    # 体里的跨表引用要并进**调用方**的占位空间；已经在场就复用同一个占位符
    entry = FxEntry(code="基准", name="基准", expression="{src.基准} * 2")
    parsed = parse_formula("{src.基准} + @基准()", library=library(entry))
    assert len(parsed.external_placeholders) == 1


def test_an_entry_reports_its_arity_and_signature() -> None:
    assert SHARE.arity == 2
    assert SHARE.signature() == "@占比(部分, 整体)"


def test_a_parameter_shows_its_label_when_it_has_one() -> None:
    assert FxParam(name="x", label="分子").display == "分子"
    assert FxParam(name="x").display == "x"
