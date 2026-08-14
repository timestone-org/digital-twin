"""锁住 node_key 的切分口径：按第一个冒号切，不合法输入一律抛而不返回 None。"""

import uuid

import pytest

from timeseries.node_key import (
    InvalidNodeKey,
    compose_node_key,
    split_node_key,
)

SOURCE_TEXT = "0198f2c0-8e00-7a1e-9c3b-2d4f6a8b0c1e"
SOURCE_ID = uuid.UUID(SOURCE_TEXT)


def test_compose_joins_source_id_and_point_code_with_a_colon() -> None:
    assert (
        compose_node_key(SOURCE_ID, "outlet_temp")
        == "0198f2c0-8e00-7a1e-9c3b-2d4f6a8b0c1e:outlet_temp"
    )


def test_compose_keeps_a_point_code_that_contains_colons() -> None:
    assert (
        compose_node_key(SOURCE_ID, "ns=2;s=Temp1:raw")
        == "0198f2c0-8e00-7a1e-9c3b-2d4f6a8b0c1e:ns=2;s=Temp1:raw"
    )


def test_compose_refuses_an_empty_point_code() -> None:
    with pytest.raises(InvalidNodeKey):
        compose_node_key(SOURCE_ID, "")


def test_split_yields_the_source_id_and_the_point_code() -> None:
    assert split_node_key(f"{SOURCE_TEXT}:outlet_temp") == (
        SOURCE_ID,
        "outlet_temp",
    )


def test_split_cuts_at_the_first_colon_only() -> None:
    assert split_node_key(f"{SOURCE_TEXT}:ns=2;s=Temp1:raw") == (
        SOURCE_ID,
        "ns=2;s=Temp1:raw",
    )


def test_split_keeps_a_non_ascii_point_code() -> None:
    assert split_node_key(f"{SOURCE_TEXT}:出口温度") == (SOURCE_ID, "出口温度")


def test_split_accepts_an_uppercase_source_id() -> None:
    assert split_node_key(f"{SOURCE_TEXT.upper()}:outlet_temp") == (
        SOURCE_ID,
        "outlet_temp",
    )


@pytest.mark.parametrize(
    "node_key",
    [
        "",
        "outlet_temp",
        SOURCE_TEXT,
    ],
    ids=["空串", "只有点位编码", "只有数据源"],
)
def test_split_refuses_a_key_without_a_separator(node_key: str) -> None:
    with pytest.raises(InvalidNodeKey):
        split_node_key(node_key)


def test_split_refuses_an_empty_point_code() -> None:
    with pytest.raises(InvalidNodeKey):
        split_node_key(f"{SOURCE_TEXT}:")


@pytest.mark.parametrize(
    "node_key",
    [
        "not-a-uuid:outlet_temp",
        ":outlet_temp",
        f"urn:uuid:{SOURCE_TEXT}:outlet_temp",
    ],
    ids=["不是 UUID", "数据源为空", "urn 前缀"],
)
def test_split_refuses_a_malformed_source_id(node_key: str) -> None:
    with pytest.raises(InvalidNodeKey):
        split_node_key(node_key)


def test_invalid_node_key_is_a_value_error_for_callers() -> None:
    assert issubclass(InvalidNodeKey, ValueError)
