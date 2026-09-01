"""函数名与元数。**元数的唯一真源**（docs/DATASET_DESIGN.md §5.3）。

三张名单必须一致：本模块的 `SCALAR_FUNCS`（元数）、`functions` 的
`SCALAR_IMPL ∪ LAZY_IMPL`（实现）、`catalog.FUNCTIONS`（喂给前端的目录）。
⚠ 三者漂移不会自报家门——目录多一个，面板里点一下报「未知函数」；白名单多
一个，求值期抛 KeyError；实现多一个，是一段看起来可用的死代码。三种症状看着
都像别处坏了，故由契约测试锁死，不靠评审记忆。
"""

# 标量函数 → (最少参数, 最多参数)；`None` = 不限。
# ⚠ 常量写成零参函数 `PI()` / `E()`：裸标识符一律判「未知标识符」是白名单
# 安全的地基，不为常量开口子（docs/DATASET_DESIGN.md §5.3）
SCALAR_FUNCS: dict[str, tuple[int, int | None]] = {
    "ABS": (1, 1),
    "ROUND": (1, 2),
    "CEIL": (1, 1),
    "FLOOR": (1, 1),
    "TRUNC": (1, 1),
    "SQRT": (1, 1),
    "POW": (2, 2),
    "SIGN": (1, 1),
    "MOD": (2, 2),
    "CLAMP": (3, 3),
    "HYPOT": (2, 2),
    "LN": (1, 1),
    "LOG10": (1, 1),
    "LOG2": (1, 1),
    "LOG": (1, 2),
    "EXP": (1, 1),
    "SIN": (1, 1),
    "COS": (1, 1),
    "TAN": (1, 1),
    "ASIN": (1, 1),
    "ACOS": (1, 1),
    "ATAN": (1, 1),
    "ATAN2": (2, 2),
    "SINH": (1, 1),
    "COSH": (1, 1),
    "TANH": (1, 1),
    "DEGREES": (1, 1),
    "RADIANS": (1, 1),
    "PI": (0, 0),
    "E": (0, 0),
    "MIN": (1, None),
    "MAX": (1, None),
    "SUM": (1, None),
    "AVG": (1, None),
    "MEDIAN": (1, None),
    "STDEV": (1, None),
    "VAR": (1, None),
    "VARP": (1, None),
    "COALESCE": (1, None),
    "NOT": (1, 1),
    "ISBLANK": (1, 1),
    "IF": (3, 3),
    "IFS": (3, None),
    "AND": (2, None),
    "OR": (2, None),
}

# 时间窗族。签名固定 `FN_OVER({列}, '窗口')`，元数恒 (2, 2)
WINDOW_FUNCS: tuple[str, ...] = (
    "SUM_OVER",
    "AVG_OVER",
    "MIN_OVER",
    "MAX_OVER",
    "COUNT_OVER",
    "FIRST_OVER",
    "LAST_OVER",
    "ALL_ZERO_OVER",
)

# 整列族。签名固定 `FN_ALL({列})`，元数恒 (1, 1)
ALL_FUNCS: tuple[str, ...] = (
    "MIN_ALL",
    "MAX_ALL",
    "AVG_ALL",
    "SUM_ALL",
    "COUNT_ALL",
)

# 模型族只有一个成员。`PREDICT('模型标识', 实参…)`
# ⚠ 第一个实参必须是**字符串字面量**：模型标识要在解析期就拿得到，才建得出
# 预取键。实参个数不限，够不够由绑定说了算（docs/MODELING_DESIGN.md §7.4）
PREDICT_FUNC = "PREDICT"

# 跨行族只有一个成员
PREV_FUNC = "PREV"
# `PREV({列}, n)` 的 n 上限
MAX_PREV_N = 100
# 一次模型调用最多几个实参（含模型标识那一个）。⚠ 有上限不是省空间：
# 它是个无界的入参列表
MAX_PREDICT_ARGS = 33

# 三族的固定元数，给目录注入用；标量族的从 `SCALAR_FUNCS` 取
FIXED_ARITY: dict[str, tuple[int, int]] = {
    PREV_FUNC: (1, 2),
    PREDICT_FUNC: (2, MAX_PREDICT_ARGS),
    **dict.fromkeys(WINDOW_FUNCS, (2, 2)),
    **dict.fromkeys(ALL_FUNCS, (1, 1)),
}


def all_function_names() -> frozenset[str]:
    """引擎认识的全部函数名（五族并集）。"""
    return frozenset(SCALAR_FUNCS) | frozenset(FIXED_ARITY)
