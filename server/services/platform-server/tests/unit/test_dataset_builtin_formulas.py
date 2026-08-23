"""出厂预设的库公式。

⚠ 预设是**代码常量，没有任何运行期信号**：改坏一条，在有人从插入面板里选中它
并保存失败之前不会有任何东西抱怨。这份用例就是那个信号。
"""

import pytest

from platform_server.apps.dataset.builtin_formulas import BUILTIN_FORMULAS
from platform_server.apps.dataset.formula import (
    PARAM_COLUMN,
    EvalContext,
    FormulaLibrary,
    FxEntry,
    evaluate,
    parse_formula,
    validate_entry,
)

PRESETS = FormulaLibrary.of(list(BUILTIN_FORMULAS))


def compute(source: str, **values: object) -> object:
    """在预设库下算一条公式。

    Args: source, values。
    """
    parsed = parse_formula(source, library=PRESETS)
    return evaluate(parsed, EvalContext(values=dict(values)))


@pytest.mark.parametrize(
    "entry", list(BUILTIN_FORMULAS), ids=[e.code for e in BUILTIN_FORMULAS]
)
def test_every_preset_validates(entry: FxEntry) -> None:
    # 校验通过就是不抛；返回值恒为 None，断言的是「走完了这一整条链」
    assert validate_entry(entry, PRESETS) is None


def test_preset_codes_are_unique() -> None:
    codes = [entry.code for entry in BUILTIN_FORMULAS]
    assert len(codes) == len(set(codes))


def test_every_value_parameter_declares_a_default() -> None:
    # ⚠ `value` 形参的默认值是「这个位置该放什么」的唯一声明，缺了它调用方
    # 拿到的是一句指向样例调用的报错
    blank = [
        f"{entry.code}.{param.name}"
        for entry in BUILTIN_FORMULAS
        for param in entry.params
        if param.kind != PARAM_COLUMN and param.default is None
    ]
    assert blank == []


def test_a_share_preset_computes_the_share_not_the_text_substitution() -> None:
    # ⚠ 文本替换会把它算成 301；正确答案是 25
    assert compute("@占比({a}, 1 + 3)", a=1) == 25.0


def test_the_safe_division_falls_back_on_a_blank_denominator() -> None:
    # ⚠ 空分母走兜底而不是整条变空——这正是这条预设存在的场景
    assert compute("@安全除(90, {分母}, 0)", 分母=None) == 0
    assert compute("@安全除(90, {分母}, 0)", 分母=0) == 0
    assert compute("@安全除(90, {分母}, 0)", 分母=3) == 30.0


def test_the_coal_equivalent_presets_keep_their_coefficients() -> None:
    # 系数按地区与年份改是**预期用法**，但改了要有人知道
    assert compute("@电力折标煤({电量})", 电量=1000) == pytest.approx(122.9)
    assert compute("@天然气折标煤({气量})", 气量=100) == pytest.approx(133.0)


def test_a_preset_call_lands_the_same_dependencies_as_typing_it_inline() -> (
    None
):
    expanded = parse_formula("@环比增长率({产量})", library=PRESETS)
    inline = parse_formula("({产量} - PREV({产量}, 1)) / PREV({产量}, 1) * 100")
    assert expanded.deps.to_json() == inline.deps.to_json()
