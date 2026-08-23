"""逻辑族：判空、取非、兜底，以及四个**惰性**分支函数。

⚠ `AND` / `OR` 走 Kleene 三值逻辑，精确规则是「**未知不中断扫描，只有决定性
取值提前返回**」。实现成「遇到第一个未知就返回空」会静默毁掉每一条
`OR(ISBLANK({x}), {x} == 0)` 守卫公式——而那正是它存在的场景。
⚠ `IF` / `IFS` 比 `AND` / `OR` **严**：条件算出空就整条中止为空，不往下一档
滑。「这一档说不准」与「这一档不成立」是两回事（docs/DATASET_DESIGN.md §5.4）。
"""

import ast
from collections.abc import Callable, Iterable

from platform_server.apps.dataset.formula.functions.wrappers import ScalarImpl
from platform_server.apps.dataset.formula.values import is_blank, truthy

# 惰性函数拿到的是**没求值的子树**加一个求值回调，自己决定算哪几支
Visit = Callable[[ast.expr], object]
LazyImpl = Callable[[list[ast.expr], Visit], object]


def kleene(values: Iterable[object], *, should_stop_on: bool) -> bool | None:
    """Kleene 三值逻辑（与 SQL 一致）。AND 传 False，OR 传 True。

    见到 `should_stop_on` 就地定案，剩下的操作数**根本不求值**——它们无论算出
    什么都改不了结论，硬算只会把一格脏数据变成整条公式报错。
    ⚠ 但**未知不定案**：扫描照常往下走。`OR(真, 未知)` 是**真**，因为那个未知
    是什么都不影响；算成未知的话，`OR(ISBLANK({x}), {x} == 0)` 会在 x 为空时
    得到空，恰恰是这句话要排除的那一档。
    Args: values（各操作数的**惰性**序列）, should_stop_on。
    """
    has_unknown = False
    for value in values:
        flag = truthy(value)
        if flag is None:
            has_unknown = True
        elif flag is should_stop_on:
            return should_stop_on
    return None if has_unknown else (not should_stop_on)


def _coalesce(args: list[object]) -> object:
    """取第一个非 `None` 的实参。

    ⚠ 判据是 `is not None` 而**不是** `is_blank`：只含空白的字符串会被
    COALESCE 取回来，而它在别处一律算空。这是刻意的——COALESCE 找的是「有没有
    给这一格填过东西」。
    Args: args。
    """
    for value in args:
        if value is not None:
            return value
    return None


def _not(args: list[object]) -> object:
    """取非。⚠ 不参与 Kleene：`NOT(空)` 还是空，不是真。

    Args: args。
    """
    flag = truthy(args[0])
    return None if flag is None else (not flag)


def _isblank(args: list[object]) -> object:
    """入参为空即真。**引擎里唯一不传染空值的函数**。

    没有它就写不出「这一列没录到数时改用另一种算法」——`{x} == 0` 在 x 为空时
    得到的是空而不是假，整条 IF 跟着变空。
    Args: args。
    """
    return is_blank(args[0])


def _lazy_if(args: list[ast.expr], visit: Visit) -> object:
    """`IF(条件, 真值, 假值)`：只算被选中的那一支。

    Args: args, visit。
    """
    flag = truthy(visit(args[0]))
    if flag is None:
        return None
    return visit(args[1]) if flag else visit(args[2])


def _lazy_ifs(args: list[ast.expr], visit: Visit) -> object:
    """`IFS(条件1, 值1, …, 兜底)`：从左到右第一个成立的条件决定取值。

    ⚠ 条件算出空就**整条中止为空**，不接着试下一档，也不落到兜底。推论：判空
    那一档必须排在任何比较档**之前**，否则它是死代码。
    Args: args, visit。
    """
    for index in range(0, len(args) - 1, 2):
        flag = truthy(visit(args[index]))
        if flag is None:
            return None
        if flag:
            return visit(args[index + 1])
    return visit(args[-1])


def _lazy_and(args: list[ast.expr], visit: Visit) -> object:
    """`AND(条件…)`。

    Args: args, visit。
    """
    return kleene((visit(arg) for arg in args), should_stop_on=False)


def _lazy_or(args: list[ast.expr], visit: Visit) -> object:
    """`OR(条件…)`。

    Args: args, visit。
    """
    return kleene((visit(arg) for arg in args), should_stop_on=True)


LOGIC_IMPL: dict[str, ScalarImpl] = {
    "COALESCE": _coalesce,
    "NOT": _not,
    "ISBLANK": _isblank,
}

# ⚠ 与 `SCALAR_IMPL` **互斥**：一个函数名只能落在其中一张表里。两张表里都有的
# 话，跑哪一份取决于 `_call` 里的分支顺序，而两份实现的任何差异都无从诊断
LAZY_IMPL: dict[str, LazyImpl] = {
    "IF": _lazy_if,
    "IFS": _lazy_ifs,
    # AND / OR 也在这里：Kleene 要「见到决定性值就停」，而 `SCALAR_IMPL` 拿到的
    # 实参已经全部求过值，停不下来
    "AND": _lazy_and,
    "OR": _lazy_or,
}
