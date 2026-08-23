"""标量聚合与统计量：对**括号里的若干个值**取值，不是对整列。

⚠ 要对整列请用 `*_ALL`，要最近一段时间请用 `*_OVER`。给单个列引用会在解析期
就被拦下并指出该用哪个函数（`parser._Walker._reject_single_column`）。
"""

import math

from platform_server.apps.dataset.formula.functions.wrappers import (
    ScalarImpl,
    aggregate,
)
from platform_server.apps.dataset.formula.values import finite, numbers_of

# 样本方差的最小样本数：除以 n-1，一个值会除零
_MIN_SAMPLE_SIZE = 2


def _median(args: list[object]) -> object:
    """中位数；偶数个取中间两个的平均。

    Args: args。
    """
    numbers = sorted(numbers_of(args, "MEDIAN"))
    if not numbers:
        return None
    middle = len(numbers) // 2
    if len(numbers) % 2:
        return numbers[middle]
    return (numbers[middle - 1] + numbers[middle]) / 2


def _variance(name: str, *, is_sample: bool) -> ScalarImpl:
    """样本 / 总体方差。

    Args: name, is_sample（样本方差除以 n-1，总体方差除以 n）。
    """

    def compute(args: list[object]) -> object:
        numbers = numbers_of(args, name)
        size = len(numbers)
        if size == 0 or (is_sample and size < _MIN_SAMPLE_SIZE):
            return None
        mean = sum(numbers) / size
        squares = sum((value - mean) ** 2 for value in numbers)
        return finite(squares / (size - 1 if is_sample else size))

    return compute


def _stdev(args: list[object]) -> object:
    """样本标准差；不足 2 个有效值为空。

    Args: args。
    """
    variance = _variance("STDEV", is_sample=True)(args)
    if not isinstance(variance, float):
        return None
    return finite(math.sqrt(variance))


AGGREGATE_IMPL: dict[str, ScalarImpl] = {
    "MIN": aggregate("MIN", min),
    "MAX": aggregate("MAX", max),
    "SUM": aggregate("SUM", sum),
    "AVG": aggregate("AVG", lambda values: sum(values) / len(values)),
    "MEDIAN": _median,
    "STDEV": _stdev,
    "VAR": _variance("VAR", is_sample=True),
    "VARP": _variance("VARP", is_sample=False),
}
