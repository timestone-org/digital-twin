"""标量函数的两张实现表。

⚠ 两张表**互斥**，并集必须**恰好等于** `signatures.SCALAR_FUNCS`。三张名单
（元数 / 实现 / 目录）漂移不会自报家门，由契约测试锁死
（docs/DATASET_DESIGN.md §5.3）。
"""

from platform_server.apps.dataset.formula.functions.aggregate import (
    AGGREGATE_IMPL,
)
from platform_server.apps.dataset.formula.functions.arithmetic import MATH_IMPL
from platform_server.apps.dataset.formula.functions.constants import CONST_IMPL
from platform_server.apps.dataset.formula.functions.explog import EXPLOG_IMPL
from platform_server.apps.dataset.formula.functions.logic import (
    LAZY_IMPL,
    LOGIC_IMPL,
    LazyImpl,
    Visit,
    kleene,
)
from platform_server.apps.dataset.formula.functions.trig import TRIG_IMPL
from platform_server.apps.dataset.formula.functions.wrappers import ScalarImpl

#: 函数名 → 实现（实参已求值；元数由解析期校验过）
SCALAR_IMPL: dict[str, ScalarImpl] = {
    **MATH_IMPL,
    **EXPLOG_IMPL,
    **TRIG_IMPL,
    **CONST_IMPL,
    **AGGREGATE_IMPL,
    **LOGIC_IMPL,
}

__all__ = [
    "LAZY_IMPL",
    "SCALAR_IMPL",
    "LazyImpl",
    "ScalarImpl",
    "Visit",
    "kleene",
]
