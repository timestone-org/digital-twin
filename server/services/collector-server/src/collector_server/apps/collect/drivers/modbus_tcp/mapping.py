"""Modbus 寄存器与协议无关 Python 值之间的映射。"""

import math
import struct
from typing import Literal

from collector_server.apps.collect.drivers.modbus_tcp.address import ModbusPoint

Order = Literal["big", "little"]

FORMATS = {
    "int16": "h",
    "uint16": "H",
    "int32": "i",
    "uint32": "I",
    "float32": "f",
    "float64": "d",
}


def decode_registers(
    point: ModbusPoint,
    registers: list[int],
    *,
    byte_order: Order,
    word_order: Order,
) -> int | float:
    """按显式字节序与字序解码一个寄存器值。

    Args: point, registers, byte_order, word_order。
    """
    words = registers[: point.width]
    if len(words) != point.width:
        raise ValueError("Modbus 响应寄存器数量不足")
    if word_order == "little":
        words.reverse()
    raw = b"".join(word.to_bytes(2, byteorder=byte_order) for word in words)
    value = struct.unpack(">" + FORMATS[point.kind], raw)[0]
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Modbus 浮点值不是有限数")
    return value
