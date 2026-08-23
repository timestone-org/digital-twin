"""把标量函数的三种收尾统一成一处：转数、定义域外收成空、结果必须有限。

⚠ **定义域外一律得空，绝不抛异常**：`LN(0)`、`ASIN(2)`、`MOD(x, 0)`、
`EXP(100000)` 都返回空。一格算不出来是数据问题，抛出去会让一行脏数据毁掉整列
（docs/DATASET_DESIGN.md §5.5，与 D3「空桶不填 0」同源）。
"""

from collections.abc import Callable

from platform_server.apps.dataset.formula.values import (
    finite,
    numbers_of,
    to_number,
)

# 标量函数：实参已经求过值，拿到的是一串值
ScalarImpl = Callable[[list[object]], object]

# 定义域外与溢出统一收成空的那几类异常
_OUT_OF_DOMAIN = (ValueError, OverflowError, ZeroDivisionError)


def unary(name: str, function: Callable[[float], float]) -> ScalarImpl:
    """一元数值函数。

    Args: name（报错文案用）, function。
    """

    def compute(args: list[object]) -> object:
        value = to_number(args[0], where=name)
        if value is None:
            return None
        try:
            return finite(function(value))
        except _OUT_OF_DOMAIN:
            return None

    return compute


def binary(name: str, function: Callable[[float, float], float]) -> ScalarImpl:
    """二元数值函数。

    Args: name, function。
    """

    def compute(args: list[object]) -> object:
        left = to_number(args[0], where=name)
        right = to_number(args[1], where=name)
        if left is None or right is None:
            return None
        try:
            return finite(function(left, right))
        except _OUT_OF_DOMAIN:
            return None

    return compute


def ternary(
    name: str, function: Callable[[float, float, float], float]
) -> ScalarImpl:
    """三元数值函数。

    Args: name, function。
    """

    def compute(args: list[object]) -> object:
        numbers = [to_number(arg, where=name) for arg in args[:3]]
        if any(number is None for number in numbers):
            return None
        first, second, third = (number or 0.0 for number in numbers)
        try:
            return finite(function(first, second, third))
        except _OUT_OF_DOMAIN:
            return None

    return compute


def aggregate(name: str, reducer: Callable[[list[float]], float]) -> ScalarImpl:
    """标量聚合：**跳过**空值，全空才为空。

    ⚠ 与四则运算相反：写 `A+B` 的人认为两项都该有值，写 `SUM(A,B)` 的人明确
    表达了「有几项算几项」（docs/DATASET_DESIGN.md §5.5）。
    Args: name, reducer。
    """

    def compute(args: list[object]) -> object:
        numbers = numbers_of(args, name)
        return reducer(numbers) if numbers else None

    return compute
