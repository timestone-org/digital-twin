"""协议、读取模式与数据类型的闭合集合。

⚠ 放开成任意字符串的话，`opuca` 这种拼写会照常入库、永不产数据、无任何告警——
而它要到采集起来才暴露（ADR-0011 的代价一节）。
"""

from typing import Literal, get_args

from collectwire import DataType

# 一期只实现 OPC UA 驱动；第二个协议进来时这里加一项，迁移里跟一条 CHECK
Protocol = Literal["opcua"]

PROTOCOLS: tuple[str, ...] = tuple(sorted(get_args(Protocol)))

# 订阅还是轮询。驱动不支持订阅时采集运行时自动降级，配置面照原样存
ReadMode = Literal["poll", "subscribe"]

READ_MODES: tuple[str, ...] = tuple(sorted(get_args(ReadMode)))

# 点位的值类型不在这里：采集侧的驱动也要按它翻现场类型，故那份闭合集合在
# `collectwire.datatypes`，两侧共用。本模块只负责把库里的字符串收窄回去。


def sql_values(values: tuple[str, ...]) -> str:
    """把取值集合渲染成 CHECK 约束里的字面量列表。

    Args: values。
    """
    return ", ".join(f"'{value}'" for value in values)


class UnknownLiteral(ValueError):
    """库里存着一个不在闭合集合里的取值。

    ⚠ 只有绕过 CHECK 约束直接改库才会走到这里。响亮抛出而不是静默兜底：
    兜底会让一条永远产不出数据的配置看起来完全正常。
    """


def as_protocol(value: str) -> Protocol:
    """把库里的字符串收窄成协议字面量。

    Args: value。
    """
    if value not in PROTOCOLS:
        raise UnknownLiteral(f"未知协议：{value!r}")
    return "opcua"


def as_read_mode(value: str) -> ReadMode:
    """把库里的字符串收窄成读取模式字面量。

    Args: value。
    """
    if value == "poll":
        return "poll"
    if value == "subscribe":
        return "subscribe"
    raise UnknownLiteral(f"未知读取模式：{value!r}")


def as_data_type(value: str) -> DataType:
    """把库里的字符串收窄成数据类型字面量。

    Args: value。
    """
    for known in ("bool", "float", "int", "string"):
        if value == known:
            return known
    raise UnknownLiteral(f"未知数据类型：{value!r}")
