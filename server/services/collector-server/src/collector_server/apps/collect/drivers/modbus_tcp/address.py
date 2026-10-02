"""Modbus 点位寻址串的严格解析与值宽度定义。"""

from dataclasses import dataclass
from typing import Literal, cast

from collector_server.apps.collect.drivers.base import PointSpec

Area = Literal["coil", "discrete", "holding", "input"]
ValueKind = Literal[
    "bool", "float32", "float64", "int16", "int32", "uint16", "uint32"
]

BIT_AREAS = frozenset({"coil", "discrete"})
REGISTER_AREAS = frozenset({"holding", "input"})
KINDS: dict[str, tuple[int, str]] = {
    "bool": (1, "bool"),
    "int16": (1, "int"),
    "uint16": (1, "int"),
    "int32": (2, "int"),
    "uint32": (2, "int"),
    "float32": (2, "float"),
    "float64": (4, "float"),
}
ADDRESS_PARTS = 3
ADDRESS_SPACE_SIZE = 65536


class AddressInvalid(ValueError):
    """寻址串不满足受支持的只读语法。"""


@dataclass(frozen=True)
class ModbusPoint:
    """已验证的 Modbus 点位。"""

    point_code: str
    area: Area
    offset: int
    kind: ValueKind
    width: int


def parse_point(spec: PointSpec) -> ModbusPoint:
    """解析 `area:zero_based_offset:value_kind`。

    Args: spec。
    """
    parts = spec.address.strip().lower().split(":")
    if len(parts) != ADDRESS_PARTS:
        raise AddressInvalid("地址必须是 area:zero_based_offset:value_kind")
    area, raw_offset, kind = parts
    if area not in BIT_AREAS | REGISTER_AREAS or kind not in KINDS:
        raise AddressInvalid("地址区域或值类型不受支持")
    try:
        offset = int(raw_offset)
    except ValueError as error:
        raise AddressInvalid("地址偏移必须是十进制整数") from error
    if not 0 <= offset < ADDRESS_SPACE_SIZE:
        raise AddressInvalid("地址偏移必须在 0..65535")
    width, normalized = KINDS[kind]
    if area in BIT_AREAS and kind != "bool":
        raise AddressInvalid("位区域只能读取 bool")
    if area in REGISTER_AREAS and kind == "bool":
        raise AddressInvalid("寄存器区域不能按 bool 解码")
    if offset + width > ADDRESS_SPACE_SIZE:
        raise AddressInvalid("多寄存器值越过地址上限")
    if spec.data_type is not None and spec.data_type != normalized:
        raise AddressInvalid("点位数据类型与 Modbus 解码类型不一致")
    return ModbusPoint(
        point_code=spec.point_code,
        area=cast(Area, area),
        offset=offset,
        kind=cast(ValueKind, kind),
        width=width,
    )
