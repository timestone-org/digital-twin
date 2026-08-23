"""三角与双曲函数。参数与返回值一律**弧度**，角度请套 `RADIANS` / `DEGREES`。"""

import math

from platform_server.apps.dataset.formula.functions.wrappers import (
    ScalarImpl,
    binary,
    unary,
)

TRIG_IMPL: dict[str, ScalarImpl] = {
    "SIN": unary("SIN", math.sin),
    "COS": unary("COS", math.cos),
    "TAN": unary("TAN", math.tan),
    # 定义域外（|x| > 1）由包装器收成空，不抛
    "ASIN": unary("ASIN", math.asin),
    "ACOS": unary("ACOS", math.acos),
    "ATAN": unary("ATAN", math.atan),
    # ⚠ 实参顺序是 (y, x)，与 `ATAN(y/x)` 相反
    "ATAN2": binary("ATAN2", math.atan2),
    "SINH": unary("SINH", math.sinh),
    "COSH": unary("COSH", math.cosh),
    "TANH": unary("TANH", math.tanh),
    "DEGREES": unary("DEGREES", math.degrees),
    "RADIANS": unary("RADIANS", math.radians),
}
