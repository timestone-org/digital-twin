"""报告可消费的纯公式入口：只接受当前指标引用。"""

from platform_server.apps.dataset.formula import (
    EvalContext,
    FormulaError,
    evaluate,
    parse_formula,
    parse_window,
    window_lower_bound,
)

__all__ = [
    "FormulaError",
    "evaluate_metrics",
    "metric_references",
    "parse_window",
    "window_lower_bound",
]


def metric_references(expression: str) -> frozenset[str]:
    """解析指标引用并拒绝未取数的跨行能力。Args: expression。"""
    parsed = parse_formula(expression)
    deps = parsed.deps
    if deps.prev or deps.window or deps.whole or deps.external or deps.model:
        raise FormulaError(
            "报告表达式只能引用已定义指标，跨期取数请配置指标偏移"
        )
    return frozenset(deps.same_row)


def evaluate_metrics(expression: str, values: dict[str, object]) -> object:
    """使用现有公式引擎求值。Args: expression, values。"""
    metric_references(expression)
    return evaluate(parse_formula(expression), EvalContext(values=values))
