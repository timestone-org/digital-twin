"""节点数据类型：对外字面量 → OPC UA VariantType，以及取值校验。

⚠ 类型名是**字符串字面量**，不是数字枚举：改一个枚举名不会动数字，但改顺序
会静默改变全部已存数据的含义（api-contract.md §6）。
"""

from typing import Literal, get_args

from asyncua import ua

from opcua_server.apps.instance.errors import NodeValueRejected

DataTypeName = Literal[
    "boolean",
    "int32",
    "int64",
    "float",
    "double",
    "string",
    "byte_string",
]

DATA_TYPE_NAMES: tuple[str, ...] = get_args(DataTypeName)

VARIANT_TYPES: dict[str, ua.VariantType] = {
    "boolean": ua.VariantType.Boolean,
    "int32": ua.VariantType.Int32,
    "int64": ua.VariantType.Int64,
    "float": ua.VariantType.Float,
    "double": ua.VariantType.Double,
    "string": ua.VariantType.String,
    "byte_string": ua.VariantType.ByteString,
}

# 整数类型的闭区间。越界必须报错——静默截断会让上位机读到一个它没写过的值。
INTEGER_RANGES: dict[str, tuple[int, int]] = {
    "int32": (-(2**31), 2**31 - 1),
    "int64": (-(2**63), 2**63 - 1),
}

DEFAULT_VALUES: dict[str, object] = {
    "boolean": False,
    "int32": 0,
    "int64": 0,
    "float": 0.0,
    "double": 0.0,
    "string": "",
    "byte_string": b"",
}


def variant_type(data_type: str) -> ua.VariantType:
    """取该数据类型对应的 VariantType，未知类型即抛。

    Args: data_type。
    """
    found = VARIANT_TYPES.get(data_type)
    if found is None:
        raise NodeValueRejected(f"不支持的数据类型：{data_type}")
    return found


def default_value(data_type: str) -> object:
    """该数据类型的初值。

    Args: data_type。
    """
    if data_type not in VARIANT_TYPES:
        raise NodeValueRejected(f"不支持的数据类型：{data_type}")
    return DEFAULT_VALUES[data_type]


def coerce(value: object, data_type: str) -> object:
    """把外部来的值收敛成该类型的 Python 值，不合法即抛。

    ⚠ 不做「尽量转换」的宽容处理：`"abc"` 写进 int32 必须报错，
    悄悄变成 0 会让上位机读到一个谁也没写过的值。

    Args: value, data_type。
    """
    if data_type not in VARIANT_TYPES:
        raise NodeValueRejected(f"不支持的数据类型：{data_type}")
    if value is None:
        raise NodeValueRejected("节点值不接受 null，请给出该类型的具体取值")
    if data_type in INTEGER_RANGES:
        return _coerce_integer(value, data_type)
    if data_type in ("float", "double"):
        return _coerce_real(value, data_type)
    if data_type == "boolean":
        return _coerce_boolean(value)
    if data_type == "string":
        return _coerce_string(value)
    return _coerce_bytes(value)


def _coerce_integer(value: object, data_type: str) -> int:
    """整数：拒绝 bool、拒绝浮点、越界即抛。

    Args: value, data_type。
    """
    if isinstance(value, bool) or not isinstance(value, int):
        raise NodeValueRejected(f"{data_type} 只接受整数")
    low, high = INTEGER_RANGES[data_type]
    if not low <= value <= high:
        raise NodeValueRejected(
            f"{data_type} 的取值范围是 [{low}, {high}]，收到 {value}"
        )
    return value


def _coerce_real(value: object, data_type: str) -> float:
    """浮点：接受 int 与 float，拒绝 bool 与字符串。

    Args: value, data_type。
    """
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise NodeValueRejected(f"{data_type} 只接受数值")
    return float(value)


def _coerce_boolean(value: object) -> bool:
    """布尔：只接受真正的 true/false。

    ⚠ 不接受 `"true"` / `1`：宽容解析会让 `"false"` 这个字符串变成 True。

    Args: value。
    """
    if not isinstance(value, bool):
        raise NodeValueRejected("boolean 只接受 true 或 false")
    return value


def _coerce_string(value: object) -> str:
    """字符串：只接受 str，不把数字悄悄转成文本。

    Args: value。
    """
    if not isinstance(value, str):
        raise NodeValueRejected("string 只接受字符串")
    return value


def _coerce_bytes(value: object) -> bytes:
    """字节串：接受 bytes，或按 UTF-8 编码的 str。

    Args: value。
    """
    if isinstance(value, bytes):
        return value
    if isinstance(value, str):
        return value.encode("utf-8")
    raise NodeValueRejected("byte_string 只接受字节串或字符串")
