"""库公式条目自身的校验：形参、体，以及拿样例调用跑一遍真解析。

⚠ 这里最贵的一条是「**默认值是位置声明**」：一个 `value` 形参落在只收字面量的
位置而没有默认值，引擎那句报错指的是样例调用，用户却要去改「默认值」那一栏。
"""

import pytest

from platform_server.apps.dataset.formula import (
    PARAM_VALUE,
    FormulaError,
    FormulaLibrary,
    FxEntry,
    FxParam,
    merged_library,
    sample_call,
    validate_entry,
)

SHARE = FxEntry(
    code="占比",
    name="占比",
    expression="{部分} / {整体} * 100",
    params=(
        FxParam(name="部分"),
        FxParam(name="整体", kind=PARAM_VALUE, default=1),
    ),
)


def library(*entries: FxEntry) -> FormulaLibrary:
    """按若干条目搭一份快照。

    Args: entries。
    """
    return FormulaLibrary.of(list(entries))


def test_a_sound_entry_passes() -> None:
    # 校验通过就是不抛；返回值恒为 None，断言的是「走完了这一整条链」
    assert validate_entry(SHARE) is None


def test_a_column_parameter_becomes_a_reference_in_the_sample_call() -> None:
    assert sample_call(SHARE) == "@占比({部分}, 1)"


def test_a_value_parameter_contributes_its_own_default() -> None:
    entry = FxEntry(
        code="滑动均值",
        name="滑动均值",
        expression="AVG_OVER({值}, {窗口})",
        params=(
            FxParam(name="值"),
            FxParam(name="窗口", kind=PARAM_VALUE, default="24h"),
        ),
    )
    assert sample_call(entry) == "@滑动均值({值}, '24h')"


def test_a_value_parameter_without_a_default_falls_back_to_one() -> None:
    # 退到 1 而不是 0：这个位置随时会去当除数
    entry = FxEntry(
        code="加",
        name="加",
        expression="{x} + 1",
        params=(FxParam(name="x", kind=PARAM_VALUE),),
    )
    assert sample_call(entry) == "@加(1)"


def test_an_illegal_code_is_refused() -> None:
    entry = FxEntry(code="占 比", name="占比", expression="1")
    with pytest.raises(FormulaError, match="公式标识"):
        validate_entry(entry)


def test_a_blank_name_is_refused() -> None:
    entry = FxEntry(code="零", name="   ", expression="0")
    with pytest.raises(FormulaError, match="名称不能为空"):
        validate_entry(entry)


def test_a_blank_body_is_refused() -> None:
    entry = FxEntry(code="零", name="零", expression="   ")
    with pytest.raises(FormulaError, match="公式体不能为空"):
        validate_entry(entry)


def test_an_illegal_parameter_name_is_refused() -> None:
    entry = FxEntry(
        code="加", name="加", expression="{a b} + 1", params=(FxParam("a b"),)
    )
    with pytest.raises(FormulaError, match="形参名"):
        validate_entry(entry)


def test_an_unknown_parameter_kind_is_refused() -> None:
    entry = FxEntry(
        code="加",
        name="加",
        expression="{x} + 1",
        params=(FxParam(name="x", kind="表达式"),),
    )
    with pytest.raises(FormulaError, match="种类"):
        validate_entry(entry)


def test_two_parameters_may_not_share_a_name() -> None:
    entry = FxEntry(
        code="加",
        name="加",
        expression="{x} + {x}",
        params=(FxParam("x"), FxParam("x")),
    )
    with pytest.raises(FormulaError, match="形参名重复"):
        validate_entry(entry)


def test_a_body_may_not_hard_code_a_ledger_column() -> None:
    # ⚠ 库公式是跨台账的：写死一张表的列，换一张表就永远算不出数
    entry = FxEntry(code="产能", name="产能", expression="{产量} * 2")
    with pytest.raises(FormulaError, match="未声明的形参：产量"):
        validate_entry(entry)


def test_a_body_may_still_reference_another_table_absolutely() -> None:
    entry = FxEntry(code="基准", name="基准", expression="{src.基准} * 2")
    assert validate_entry(entry) is None


def test_a_parameter_nobody_uses_is_refused() -> None:
    entry = FxEntry(
        code="加",
        name="加",
        expression="{x} + 1",
        params=(FxParam("x"), FxParam("y")),
    )
    with pytest.raises(FormulaError, match="没被用到"):
        validate_entry(entry)


def test_a_value_parameter_in_a_literal_only_slot_needs_a_default() -> None:
    # ⚠ 引擎那句话指的是样例调用里的某个位置，界面上要改的却是「默认值」那栏
    entry = FxEntry(
        code="滑动均值",
        name="滑动均值",
        expression="AVG_OVER({值}, {窗口})",
        params=(
            FxParam(name="值"),
            FxParam(name="窗口", kind=PARAM_VALUE, label="时间窗"),
        ),
    )
    with pytest.raises(FormulaError, match="时间窗 还没有默认值") as caught:
        validate_entry(entry)
    assert "时间窗必须是字符串字面量" in str(caught.value)
    assert "默认值就是它在体里那个位置的唯一声明" in str(caught.value)


def test_the_same_slot_passes_once_the_default_is_filled_in() -> None:
    entry = FxEntry(
        code="滑动均值",
        name="滑动均值",
        expression="AVG_OVER({值}, {窗口})",
        params=(
            FxParam(name="值"),
            FxParam(name="窗口", kind=PARAM_VALUE, default="24h"),
        ),
    )
    assert validate_entry(entry) is None


def test_an_unrelated_error_does_not_get_the_default_hint() -> None:
    entry = FxEntry(
        code="坏",
        name="坏",
        expression="{x} +",
        params=(FxParam(name="x", kind=PARAM_VALUE),),
    )
    with pytest.raises(FormulaError, match="语法错误") as caught:
        validate_entry(entry)
    assert "默认值" not in str(caught.value)


def test_a_draft_that_would_close_a_ring_is_refused() -> None:
    # `@甲` 已经在调 `@乙`，这条草稿让 `@乙` 反过来调 `@甲`
    existing = FxEntry(code="甲", name="甲", expression="@乙() + 1")
    draft = FxEntry(code="乙", name="乙", expression="@甲() + 1")
    with pytest.raises(FormulaError, match="互相调用成环"):
        validate_entry(draft, library(existing, draft))


def test_nesting_into_another_library_formula_is_fine() -> None:
    inner = FxEntry(code="翻倍", name="翻倍", expression="2 * 2")
    draft = FxEntry(code="四倍", name="四倍", expression="@翻倍() * 2")
    assert validate_entry(draft, library(inner)) is None


def test_calling_a_formula_that_is_not_in_the_library_is_refused() -> None:
    # ⚠ 报的是「库里没有」而不是「库是空的」：草稿自己已经并进快照了
    draft = FxEntry(code="四倍", name="四倍", expression="@翻倍() * 2")
    with pytest.raises(FormulaError, match="公式库里没有 '翻倍'"):
        validate_entry(draft)


def test_the_draft_replaces_the_stored_version_during_validation() -> None:
    # ⚠ 校验看到的必须是**保存之后**的库，否则改法总是按旧口径判
    stored = FxEntry(code="占比", name="占比", expression="1")
    merged = merged_library(SHARE, library(stored))
    assert merged.get("占比") == SHARE


def test_merging_an_unchanged_entry_hands_back_the_same_snapshot() -> None:
    snapshot = library(SHARE)
    assert merged_library(SHARE, snapshot) is snapshot
