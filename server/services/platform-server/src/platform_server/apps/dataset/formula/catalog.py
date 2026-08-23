"""喂给前端公式编辑器的函数目录：分类、函数、运算符、时间窗与几条口径说明。

⚠ 前端的函数面板**零硬编码函数名**。参考实现早期硬编码了 5 个，后端加了对数与
三角族之后整族在界面上不可见，用户报「算不了 ln」（docs/DATASET_DESIGN.md
§5.3）。
"""

from dataclasses import dataclass

from platform_server.apps.dataset.formula.function_docs import (
    FUNCTION_DOCS,
    FunctionDoc,
)
from platform_server.apps.dataset.formula.library import FormulaLibrary
from platform_server.apps.dataset.formula.signatures import (
    FIXED_ARITY,
    SCALAR_FUNCS,
)

# 分类顺序即面板里的分组顺序
CATEGORIES: tuple[tuple[str, str], ...] = (
    ("math", "数学"),
    ("explog", "对数与指数"),
    ("trig", "三角函数"),
    ("const", "常量"),
    ("logic", "逻辑"),
    ("aggregate", "聚合"),
    ("stat", "统计量"),
    ("history", "跨行与时间窗"),
    ("whole", "整列统计"),
)

# 运算符速查。⚠ `//` 与一元 `not` 解析器认，但**不在这里宣传**：前者容易被
# 当成注释，后者写成 `NOT(...)` 更好读
OPERATORS: tuple[tuple[str, str], ...] = (
    ("+", "加"),
    ("-", "减"),
    ("*", "乘"),
    ("/", "除（除数为 0 时结果为空）"),
    ("%", "取余（符号随除数，与 MOD 一致）"),
    ("**", "幂"),
    ("( )", "分组"),
    (">  >=  <  <=", "比较"),
    ("==  !=", "等于 / 不等于"),
    ("and  or", "逻辑与 / 或"),
)

# 时间窗写法速查
WINDOW_UNITS: tuple[tuple[str, str], ...] = (
    ("30s", "30 秒"),
    ("15m", "15 分钟（m 是分钟，不是月）"),
    ("1h", "1 小时"),
    ("1d", "1 天"),
    ("1w", "1 周"),
    ("3mo", "3 个月（也可写 3月）"),
    ("1y", "1 年（也可写 1年）"),
)

# 编辑器里直接展示的求值口径。⚠ 与 docs/DATASET_DESIGN.md §5 逐字对应，
# 免得实现与文档各说一套
RULES: tuple[str, ...] = (
    "普通四则运算（+ - * /）里任一值为空，结果就为空——缺失不等于 0，"
    "想跳过缺失请改用 SUM / AVG",
    "SUM / AVG / MIN / MAX 以及所有 *_OVER、*_ALL 都会自动跳过缺失值",
    "除数为 0 时结果为空",
    "MIN / MAX / SUM / AVG 是对括号里若干个值取值，不是对整列——"
    "要对整列请用 MIN_ALL / MAX_ALL 等",
    "PREV 取当前记录之前的行；时间窗 *_OVER **含当前行**；"
    "整列统计 *_ALL 含全部行",
    "月与年按日历算：3 月 31 日往前 1 个月是 2 月 28 日，不是 30 天前",
    "判空只能用 ISBLANK：{列} == 0 在该列为空时得到的是空、不是假，"
    "整条公式会跟着变空",
    "用了 *_ALL 的列，任何一行改动都会让整表结果变化，记得重算公式列",
    "公式可以引用其它公式列，但不能绕成环",
)


@dataclass(frozen=True)
class CatalogFunction:
    """一个函数在目录里的完整条目：说明 + **注入的**元数。"""

    doc: FunctionDoc
    min_args: int
    max_args: int | None


@dataclass(frozen=True)
class FormulaCatalog:
    """整份目录。"""

    functions: tuple[CatalogFunction, ...]
    library: tuple[str, ...]


def build_catalog(library: FormulaLibrary) -> FormulaCatalog:
    """按 `FUNCTION_DOCS` 的顺序出目录，元数从 `signatures` 注入。

    Args: library（公式库快照，只列启用中的）。
    """
    return FormulaCatalog(
        functions=tuple(_with_arity(doc) for doc in FUNCTION_DOCS),
        library=tuple(item.code for item in library.enabled_entries()),
    )


def _with_arity(doc: FunctionDoc) -> CatalogFunction:
    """给一条说明配上它的元数。

    Args: doc。
    """
    low, high = SCALAR_FUNCS.get(doc.name) or FIXED_ARITY[doc.name]
    return CatalogFunction(doc=doc, min_args=low, max_args=high)
