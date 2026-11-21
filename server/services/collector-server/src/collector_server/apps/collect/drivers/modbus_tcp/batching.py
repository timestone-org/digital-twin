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
    end = 0
    for point in ordered:
        limit = max_bits if point.area in BIT_AREAS else max_registers
        if point.width > limit:
            raise AddressInvalid("点位宽度超过单次读取上限")
        point_end = point.offset + point.width
        if current and _fits(current[0], point, end, limit):
            current.append(point)
            end = max(end, point_end)
            continue
        if current:
            batches.append(_batch(current, end))
        current = [point]
        end = point_end
    if current:
        batches.append(_batch(current, end))
    return tuple(batches)


def _fits(first: ModbusPoint, point: ModbusPoint, end: int, limit: int) -> bool:
    return (
        first.area == point.area
        and point.offset <= end
        and max(end, point.offset + point.width) - first.offset <= limit
    )


def _batch(points: list[ModbusPoint], end: int) -> ReadBatch:
    start = points[0].offset
    return ReadBatch(
        area=points[0].area,
        offset=start,
        count=end - start,
        points=tuple(points),
    )
