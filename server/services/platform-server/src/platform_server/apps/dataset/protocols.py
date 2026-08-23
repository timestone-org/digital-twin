"""台账里五组闭合取值：采集模式、列来源、列类型、聚合口径、行来源。

⚠ 放开成任意字符串的话，`aggregate` 写成 `aggregat` 会照常入库、永远不出行、
也不告警——它要到下一个周期到点才暴露（docs/DATASET_DESIGN.md §4.2）。
"""

from typing import Literal, get_args

# 一张台账的行怎么来：只人工录入，还是按周期从点位历史聚合
CollectMode = Literal["aggregate", "manual"]

COLLECT_MODES: tuple[str, ...] = tuple(sorted(get_args(CollectMode)))

# ⚠ 中间那档是 `point` 不是 `opcua`：列绑的是一个**点位**，与它背后跑的是哪个
# 协议无关（ADR-0011）。写死协议名会让「同一张台账里既有 OPC UA 点位又有
# Modbus 点位」这件本来天然成立的事看起来像是没做。
ColumnSource = Literal["formula", "manual", "point"]

COLUMN_SOURCES: tuple[str, ...] = tuple(sorted(get_args(ColumnSource)))

# 一格里装的是什么。精确小数对外走 string，故这里没有单独的 decimal 档
ColumnType = Literal["bool", "number", "string"]

COLUMN_TYPES: tuple[str, ...] = tuple(sorted(get_args(ColumnType)))

# 桶内的 N 条点位历史折成一个数的八种口径，语义见 docs/DATASET_DESIGN.md §4.4。
# ⚠ 台账自己出一份白名单，不去改采集那份五档的 `AGGREGATE_SQL`：那是点位历史
# 读侧的对外契约，两个消费者的口径不该互相牵连。
AggFunc = Literal["avg", "count", "delta", "first", "last", "max", "min", "sum"]

AGG_FUNCS: tuple[str, ...] = tuple(sorted(get_args(AggFunc)))

# 一行台账是谁写出来的
RecordSource = Literal["collect", "import", "manual"]

RECORD_SOURCES: tuple[str, ...] = tuple(sorted(get_args(RecordSource)))


def sql_values(values: tuple[str, ...]) -> str:
    """把取值集合渲染成 CHECK 约束里的字面量列表。

    Args: values。
    """
    return ", ".join(f"'{value}'" for value in values)


class UnknownLiteral(ValueError):
    """库里存着一个不在闭合集合里的取值。

    ⚠ 只有绕过 CHECK 约束直接改库才会走到这里。响亮抛出而不是静默兜底：
    兜底会让一列永远算不出数的配置看起来完全正常。
    """


def as_collect_mode(value: str) -> CollectMode:
    """把库里的字符串收窄成采集模式字面量。

    Args: value。
    """
    for known in ("aggregate", "manual"):
        if value == known:
            return known
    raise UnknownLiteral(f"未知采集模式：{value!r}")


def as_column_source(value: str) -> ColumnSource:
    """把库里的字符串收窄成列来源字面量。

    Args: value。
    """
    for known in ("formula", "manual", "point"):
        if value == known:
            return known
    raise UnknownLiteral(f"未知列来源：{value!r}")


def as_column_type(value: str) -> ColumnType:
    """把库里的字符串收窄成列类型字面量。

    Args: value。
    """
    for known in ("bool", "number", "string"):
        if value == known:
            return known
    raise UnknownLiteral(f"未知列类型：{value!r}")


def as_agg_func(value: str) -> AggFunc:
    """把库里的字符串收窄成聚合口径字面量。

    Args: value。
    """
    for known in (
        "avg",
        "count",
        "delta",
        "first",
        "last",
        "max",
        "min",
        "sum",
    ):
        if value == known:
            return known
    raise UnknownLiteral(f"未知聚合口径：{value!r}")


def as_record_source(value: str) -> RecordSource:
    """把库里的字符串收窄成行来源字面量。

    Args: value。
    """
    for known in ("collect", "import", "manual"):
        if value == known:
            return known
    raise UnknownLiteral(f"未知行来源：{value!r}")
