"""绑定来源的闭合集合，与前端 `@dt/contracts` 的 `BINDING_SOURCE_KINDS` 同口径。

⚠ 放开成任意字符串的话，`opuca` 这种拼写会照常入库、永不产数据、无任何告警
（docs/DASHBOARD_DESIGN.md §4.1）。
"""

from typing import Literal, get_args

SourceKind = Literal["archive", "computed", "opcua", "static"]

SOURCE_KINDS: tuple[str, ...] = tuple(sorted(get_args(SourceKind)))

# 走实时推送的那一种。⚠ `archive` 也指向点位，但它要的是历史序列，不该被
# publisher 当成现值推出去
REALTIME_SOURCE_KIND: SourceKind = "opcua"

# `computed` 的运算符，与前端 `COMPUTE_OPS` 同口径
ComputeOp = Literal["avg", "diff", "max", "min", "product", "ratio", "sum"]

COMPUTE_OPS: tuple[str, ...] = tuple(sorted(get_args(ComputeOp)))


def sql_values(values: tuple[str, ...]) -> str:
    """把取值集合渲染成 CHECK 约束里的字面量列表。

    Args: values。
    """
    return ", ".join(f"'{value}'" for value in values)
