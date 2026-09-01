"""`PREDICT` 这一族：解析、取数相位、求值与降级。

⚠ 全程零 fixture：模型在求值器眼里只是一个同步纯计算的可调用对象，用例给一个
两行的假件就验得完（docs/MODELING_DESIGN.md D26）。
"""

from datetime import UTC, datetime

import pytest

from platform_server.apps.dataset.formula import (
    AnalysisUnavailable,
    EvalContext,
    FormulaError,
    HistoryCache,
    build_externals,
    evaluate,
    parse_formula,
)

TZ = datetime.now(UTC).tzinfo
KNOWN = {"温度", "负荷", "能耗"}


class TwiceSum:
    """一个假模型：把实参求和再乘二。空实参一律当算不出来。"""

    def predict(self, args: list[float | None]) -> float | None:
        """Args: args。"""
        if any(item is None for item in args):
            return None
        return 2 * sum(item or 0.0 for item in args)


def context_of(
    source: str, values: dict[str, object], models: dict[str, object]
) -> tuple[object, EvalContext]:
    """把一条公式解析好、把相位装齐。

    Args: source, values, models。
    """
    parsed = parse_formula(source, known_keys=KNOWN)
    cache = HistoryCache(tz=TZ)
    cache.models = models  # pyright: ignore[reportAttributeAccessIssue]
    return parsed, EvalContext(
        values=values,
        externals=build_externals(parsed.deps, cache, datetime.now(UTC)),
    )


def test_a_model_call_lands_in_its_own_dependency_bucket() -> None:
    """模型调用只登记标识，不登记实参；实参照常进同行依赖。"""
    parsed = parse_formula(
        "PREDICT('能耗预测', {温度}, {负荷})", known_keys=KNOWN
    )
    assert [ref.code for ref in parsed.deps.model] == ["能耗预测"]
    assert parsed.deps.same_row == {"温度", "负荷"}


def test_the_model_identifier_must_be_a_string_literal() -> None:
    """模型标识必须是字面量——解析期拿不到它就建不出预取键。"""
    with pytest.raises(FormulaError):
        parse_formula("PREDICT({温度}, {负荷})", known_keys=KNOWN)


def test_a_bound_model_produces_a_number() -> None:
    """接上模型之后，公式列真出数。"""
    parsed, context = context_of(
        "PREDICT('能耗预测', {温度}, {负荷})",
        {"温度": 3.0, "负荷": 4.0},
        {"能耗预测": TwiceSum()},
    )
    assert evaluate(parsed, context) == pytest.approx(14.0)


def test_the_arguments_may_be_arbitrary_expressions() -> None:
    """实参可以是任意表达式——它们在行内求值。

    ⚠ 这正是走「装模型定义」而不是「逐行请求」换来的：参考实现必须禁止实参是
    公式列，因为它的分析取数发生在公式求值之前。
    """
    parsed, context = context_of(
        "PREDICT('能耗预测', {温度} * 2, {负荷} + 1)",
        {"温度": 3.0, "负荷": 4.0},
        {"能耗预测": TwiceSum()},
    )
    assert evaluate(parsed, context) == pytest.approx(22.0)


def test_an_unbound_model_says_why() -> None:
    """没绑定时给一句人话，而不是一格莫名其妙的空白。"""
    parsed, context = context_of("PREDICT('还没绑', {温度})", {"温度": 1.0}, {})
    with pytest.raises(FormulaError, match="模型未绑定"):
        evaluate(parsed, context)


def test_an_unavailable_model_passes_its_reason_through() -> None:
    """提供者给的原因原样透到那一格上。"""
    parsed, context = context_of(
        "PREDICT('坏了的', {温度})",
        {"温度": 1.0},
        {"坏了的": AnalysisUnavailable(reason="模型版本不可上线")},
    )
    with pytest.raises(FormulaError, match="模型版本不可上线"):
        evaluate(parsed, context)


def test_a_model_may_return_nothing() -> None:
    """模型自己算不出来时给空，不是报错——缺一个实参是常态。"""
    parsed, context = context_of(
        "PREDICT('能耗预测', {温度}, {负荷})",
        {"温度": 3.0, "负荷": None},
        {"能耗预测": TwiceSum()},
    )
    assert evaluate(parsed, context) is None


def test_the_result_can_be_used_in_arithmetic() -> None:
    """预测值就是一个普通的数，能接着算。"""
    parsed, context = context_of(
        "PREDICT('能耗预测', {温度}) / 2 + 1",
        {"温度": 5.0},
        {"能耗预测": TwiceSum()},
    )
    assert evaluate(parsed, context) == pytest.approx(6.0)
