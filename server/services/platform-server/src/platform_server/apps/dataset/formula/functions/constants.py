"""常量。

⚠ 写成**零参函数** `PI()` / `E()`：裸标识符一律判「未知标识符」是白名单安全的
地基，不为常量开口子（docs/DATASET_DESIGN.md §5.3）。
"""

import math

from platform_server.apps.dataset.formula.functions.wrappers import ScalarImpl

CONST_IMPL: dict[str, ScalarImpl] = {
    "PI": lambda _args: math.pi,
    "E": lambda _args: math.e,
}
