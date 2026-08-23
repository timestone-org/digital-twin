"""基础数学：取整、开方、幂、符号、取余、夹取。"""

import math

from platform_server.apps.dataset.formula.functions.wrappers import (
    ScalarImpl,
    binary,
    ternary,
    unary,
)
from platform_server.apps.dataset.formula.values import to_number


def _round(args: list[object]) -> object:
    """四舍五入到 n 位小数，n 省略即取整。

    Args: args。
    """
    value = to_number(args[0], where="ROUND")
    if value is None:
        return None
    digits = to_number(args[1] if len(args) > 1 else 0, where="ROUND 的小数位")
    return round(value, int(digits or 0))


def _sign(value: float) -> float:
    """正 1 / 负 -1 / 零 0。

    ⚠ `-0.0` 要归成 `0.0`：`copysign(1.0, -0.0)` 给的是 -1。
    Args: value。
    """
    return 0.0 if value == 0 else math.copysign(1.0, value)


# ⚠ `%` 与 `MOD()` 取同一个口径：结果随**除数**符号（`-1 % 3 == 2`），与电子
# 表格的 MOD 一致。参考实现让 `MOD` 走 `math.fmod`（随被除数），两个写法对负数
# 算出不同的数——台账的用户是拿电子表格思维来的，本仓从第一天就统一
# （docs/DATASET_DESIGN.md §5.7）
MATH_IMPL: dict[str, ScalarImpl] = {
    # ⚠ 用 `math.fabs` 而不是内建 `abs`：实参在这里已经是 float，两者结果
    # 相同，但前者的签名是确定的 `(float) -> float`
    "ABS": unary("ABS", math.fabs),
    "CEIL": unary("CEIL", lambda value: float(math.ceil(value))),
    "FLOOR": unary("FLOOR", lambda value: float(math.floor(value))),
    "TRUNC": unary("TRUNC", lambda value: float(math.trunc(value))),
    "SQRT": unary("SQRT", math.sqrt),
    "POW": binary("POW", math.pow),
    "SIGN": unary("SIGN", _sign),
    "MOD": binary("MOD", lambda value, divisor: value % divisor),
    "CLAMP": ternary(
        "CLAMP", lambda value, low, high: max(low, min(high, value))
    ),
    "HYPOT": binary("HYPOT", math.hypot),
    "ROUND": _round,
}
