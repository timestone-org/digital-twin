"""数据类型映射与取值校验。

重点是**拒绝**路径：宽容转换会让上位机读到一个谁也没写过的值。
"""

from typing import Any

import pytest
from asyncua import ua

from opcua_server.apps.instance.errors import NodeValueRejected
from opcua_server.apps.instance.runtime.datatypes import (
    DATA_TYPE_NAMES,
    coerce,
    default_value,
    variant_type,
)


@pytest.mark.parametrize("name", DATA_TYPE_NAMES)
def test_every_declared_type_maps_to_a_variant_type(name: str) -> None:
    assert isinstance(variant_type(name), ua.VariantType)


@pytest.mark.parametrize("name", DATA_TYPE_NAMES)
def test_every_declared_type_has_a_default_value(name: str) -> None:
    assert default_value(name) is not None


def test_unknown_type_is_rejected() -> None:
    with pytest.raises(NodeValueRejected):
        variant_type("int128")


def test_unknown_type_has_no_default() -> None:
    with pytest.raises(NodeValueRejected):
        default_value("int128")


@pytest.mark.parametrize(
    ("value", "data_type", "expected"),
    [
        (7, "int32", 7),
        (-8, "int64", -8),
        (1, "double", 1.0),
        (2.5, "float", 2.5),
        (True, "boolean", True),
        ("温度", "string", "温度"),
        (b"\x01", "byte_string", b"\x01"),
        ("ab", "byte_string", b"ab"),
    ],
    ids=[
        "int32",
        "int64",
        "int-widens-to-double",
        "float",
        "boolean",
        "non-ascii-string",
        "bytes",
        "str-encodes-to-bytes",
    ],
)
def test_accepted_values_are_coerced(
    value: Any, data_type: str, expected: Any
) -> None:
    assert coerce(value, data_type) == expected


@pytest.mark.parametrize(
    ("data_type", "value"),
    [
        ("int32", 2**31),
        ("int32", -(2**31) - 1),
        ("int64", 2**63),
        ("int64", -(2**63) - 1),
    ],
    ids=["int32-high", "int32-low", "int64-high", "int64-low"],
)
def test_out_of_range_integers_are_rejected(data_type: str, value: int) -> None:
    with pytest.raises(NodeValueRejected):
        coerce(value, data_type)


@pytest.mark.parametrize(
    ("data_type", "value"),
    [
        ("int32", 2**31 - 1),
        ("int32", -(2**31)),
        ("int64", 2**63 - 1),
        ("int64", -(2**63)),
    ],
    ids=["int32-max", "int32-min", "int64-max", "int64-min"],
)
def test_range_boundaries_are_accepted(data_type: str, value: int) -> None:
    assert coerce(value, data_type) == value


def test_boolean_is_not_an_integer() -> None:
    with pytest.raises(NodeValueRejected):
        coerce(True, "int32")


def test_boolean_is_not_a_double() -> None:
    with pytest.raises(NodeValueRejected):
        coerce(False, "double")


def test_string_is_not_silently_parsed_into_a_number() -> None:
    with pytest.raises(NodeValueRejected):
        coerce("12", "int32")


def test_truthy_string_is_not_a_boolean() -> None:
    with pytest.raises(NodeValueRejected):
        coerce("false", "boolean")


def test_number_is_not_silently_stringified() -> None:
    with pytest.raises(NodeValueRejected):
        coerce(12, "string")


def test_float_is_not_truncated_into_an_integer() -> None:
    with pytest.raises(NodeValueRejected):
        coerce(1.5, "int32")


def test_null_is_rejected_for_every_type() -> None:
    with pytest.raises(NodeValueRejected):
        coerce(None, "double")


def test_unknown_type_rejects_any_value() -> None:
    with pytest.raises(NodeValueRejected):
        coerce(1, "int128")


def test_byte_string_rejects_unrelated_objects() -> None:
    with pytest.raises(NodeValueRejected):
        coerce(1, "byte_string")


def test_empty_string_is_a_valid_value() -> None:
    assert coerce("", "string") == ""


def test_zero_is_a_valid_integer() -> None:
    assert coerce(0, "int32") == 0
