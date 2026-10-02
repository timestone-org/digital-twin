"""把连续 Modbus 地址合成有上限的只读请求。"""

from dataclasses import dataclass

from collector_server.apps.collect.drivers.modbus_tcp.address import (
    BIT_AREAS,
    AddressInvalid,
    ModbusPoint,
)


@dataclass(frozen=True)
class ReadBatch:
    """一个协议读请求及其覆盖点位。"""

    area: str
    offset: int
    count: int
    points: tuple[ModbusPoint, ...]


def build_batches(
    points: list[ModbusPoint], *, max_registers: int, max_bits: int
) -> tuple[ReadBatch, ...]:
    """只合并相邻或重叠地址，不跨未批准的间隙。

    Args: points, max_registers, max_bits。
    """
    ordered = sorted(points, key=lambda item: (item.area, item.offset))
    batches: list[ReadBatch] = []
    current: list[ModbusPoint] = []
    for point in ordered:
        limit = max_bits if point.area in BIT_AREAS else max_registers
        if point.width > limit:
            raise AddressInvalid("点位宽度超过单次读取上限")
        if current and _fits(current, point, limit):
            current.append(point)
            continue
        if current:
            batches.append(_batch(current))
        current = [point]
    if current:
        batches.append(_batch(current))
    return tuple(batches)


def _fits(current: list[ModbusPoint], point: ModbusPoint, limit: int) -> bool:
    first = current[0]
    end = max(item.offset + item.width for item in current)
    return (
        first.area == point.area
        and point.offset <= end
        and max(end, point.offset + point.width) - first.offset <= limit
    )


def _batch(points: list[ModbusPoint]) -> ReadBatch:
    start = points[0].offset
    end = max(point.offset + point.width for point in points)
    return ReadBatch(
        area=points[0].area,
        offset=start,
        count=end - start,
        points=tuple(points),
    )
