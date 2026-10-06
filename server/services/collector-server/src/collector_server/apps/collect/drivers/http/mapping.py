"""JSON Pointer 定位与点位标量类型收敛，单点错误不影响同响应其它点位。"""

import math
import re

from pydantic import JsonValue

from collectwire import DataType
from collectwire.http import validate_http_pointer

_ARRAY_INDEX = re.compile(r"^(0|[1-9][0-9]*)$")
_INTEGER = re.compile(r"^[+-]?[0-9]+$")
MAX_SAFE_INTEGER = 9_007_199_254_740_991


def resolve_pointer(document: JsonValue, address: str) -> JsonValue:
    """按 RFC 6901 提取值。

    Args: document, address。
    """
    validate_http_pointer(address)
    if address == "$":
        return document
    current = document
    for encoded in address[1:].split("/"):
        token = encoded.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and token in current:
            current = current[token]
        elif isinstance(current, list) and _ARRAY_INDEX.fullmatch(token):
            index = int(token)
            if index >= len(current):
                raise ValueError("JSON 数组索引不存在")
            current = current[index]
        else:
            raise ValueError("JSON 路径不存在")
    return current


def convert_value(value: JsonValue, data_type: DataType | None) -> object:
    """把 JSON 标量收敛为点位声明类型。

    Args: value, data_type。
    """
    if value is None or isinstance(value, (dict, list)):
        raise ValueError("HTTP 点位必须是非空标量")
    if data_type == "bool":
        return _boolean(value)
    if data_type == "int":
        return _integer(value)
    if data_type == "float":
        return _float(value)
    if data_type == "string":
        if isinstance(value, str):
            return value
        if isinstance(value, int) and not isinstance(value, bool):
            return str(value)
        raise ValueError("HTTP 字符串点位只接受字符串或整数")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("HTTP 点位数值不是有限值")
    return value


def _boolean(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if value in (0, 1, "0", "1"):
        return value in (1, "1")
    if isinstance(value, str) and value.casefold() in ("true", "false"):
        return value.casefold() == "true"
    raise ValueError("HTTP 点位不是布尔值")


def _integer(value: object) -> int:
    if isinstance(value, int) and not isinstance(value, bool):
        result = value
    elif isinstance(value, str) and _INTEGER.fullmatch(value):
        result = int(value)
    else:
        raise ValueError("HTTP 点位不是整数")
    if abs(result) > MAX_SAFE_INTEGER:
        raise ValueError("HTTP 大整数点位应使用字符串类型")
    return result


def _float(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError("HTTP 点位不是数值")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("HTTP 点位数值不是有限值")
    return result
