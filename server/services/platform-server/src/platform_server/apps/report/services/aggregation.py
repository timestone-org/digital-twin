"""报告标量聚合及输出格式化，保留十进制精度。"""

from collections.abc import Sequence
from decimal import Decimal, InvalidOperation
from typing import Literal

from platform_server.apps.report.schemas.common import Aggregation
from platform_server.apps.report.schemas.preview import MetricValue


def decimal_value(value: object) -> Decimal | None:
    """收敛一个有限十进制数。Args: value。"""
    if value is None:
        return None
    if isinstance(value, bool):
        return Decimal(int(value))
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def wire_value(value: object) -> str | bool | None:
    """数值以 string 输出，未知值保持为空。Args: value。"""
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float, Decimal)):
        number = decimal_value(value)
        return format(number, "f") if number is not None else None
    return str(value)


def aggregate(values: Sequence[object], mode: Aggregation) -> object:
    """归并一列，缺失不补零。Args: values, mode。"""
    present = [value for value in values if value is not None]
    if mode == "count":
        return len(present)
    if not present:
        return None
    if mode == "first":
        return present[0]
    if mode == "last":
        return present[-1]
    numbers = [
        number
        for value in present
        if (number := decimal_value(value)) is not None
    ]
    if not numbers:
        return None
    return _aggregate_numbers(numbers, mode)


def _aggregate_numbers(
    numbers: list[Decimal], mode: Aggregation
) -> Decimal | None:
    if mode == "delta":
        return numbers[-1] - numbers[0] if len(numbers) > 1 else None
    if mode == "min":
        return min(numbers)
    if mode == "max":
        return max(numbers)
    total = sum(numbers, Decimal(0))
    return total / len(numbers) if mode == "avg" else total


def format_number(value: object, precision: int = 2, unit: str = "") -> str:
    """格式化文档数字，缺失显示占位。Args: value, precision, unit。"""
    if value is None:
        return "—"
    number = decimal_value(value)
    text = (
        str(value)
        if number is None
        else f"{number:.{max(0, min(12, precision))}f}"
    )
    return f"{text}{unit}"


def value_kind(value: object) -> Literal["number", "text", "boolean", "empty"]:
    if value is None:
        return "empty"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float, Decimal)):
        return "number"
    return "text"


def formula_values(metrics: Sequence[MetricValue]) -> dict[str, object]:
    """恢复序列化前的数值类别。Args: metrics。"""
    values: dict[str, object] = {}
    for metric in metrics:
        number = decimal_value(metric.value)
        values[metric.name] = (
            float(number)
            if metric.value_kind == "number" and number is not None
            else metric.value
        )
    return values
