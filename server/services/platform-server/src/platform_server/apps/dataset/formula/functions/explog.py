"""对数与指数。

⚠ **`LOG(x)` 是自然对数**，不猜默认底。Excel 的 LOG 默认 10、工程里的 log
通常指 ln——没有一个答案是对的，故不猜；要十进制请明写 `LOG10`
（docs/DATASET_DESIGN.md §5.3）。
"""

import math

from platform_server.apps.dataset.formula.functions.wrappers import (
    ScalarImpl,
    unary,
)
from platform_server.apps.dataset.formula.values import finite, to_number


def _log(args: list[object]) -> object:
    """一个参数取自然对数，两个参数取指定底。

    Args: args。
    """
    value = to_number(args[0], where="LOG")
    if value is None or value <= 0:
        return None
    if len(args) == 1:
        return finite(math.log(value))
    base = to_number(args[1], where="LOG 的底数")
    # 底数 ≤0 或 =1 时对数无定义（1 为底会除以 log(1)=0）
    if base is None or base <= 0 or base == 1:
        return None
    try:
        return finite(math.log(value, base))
    except (ValueError, OverflowError, ZeroDivisionError):
        return None


EXPLOG_IMPL: dict[str, ScalarImpl] = {
    "LN": unary("LN", math.log),
    "LOG10": unary("LOG10", math.log10),
    "LOG2": unary("LOG2", math.log2),
    "EXP": unary("EXP", math.exp),
    "LOG": _log,
}
