"""点位汇总列必须绑一个形状合法的点位身份，且只验形状不验存在。"""

import pytest

from lib.errors.base import FieldError
from platform_server.apps.dataset.errors import DatasetColumnInvalid
from platform_server.apps.dataset.protocols import ColumnSource
from platform_server.apps.dataset.services.column_rules import (
    check_point_binding,
)

SOURCE_ID = "0192f0c0-0000-7000-8000-00000000abcd"
GOOD_KEY = f"{SOURCE_ID}:outlet_temp"


def assert_accepted(*, source: ColumnSource, node_key: str | None) -> None:
    """这一对配置合法，契约就是「不抛」。

    Args: source, node_key。
    """
    check_point_binding(source=source, node_key=node_key)


def test_a_manual_column_needs_no_node_key() -> None:
    assert_accepted(source="manual", node_key=None)


def test_a_formula_column_needs_no_node_key() -> None:
    assert_accepted(source="formula", node_key=None)


def test_a_point_column_with_a_well_shaped_key_passes() -> None:
    assert_accepted(source="point", node_key=GOOD_KEY)


def test_a_point_column_binding_an_unknown_point_still_passes() -> None:
    # ⚠ 只验形状：点位可以晚于台账建，也可以先于台账删
    assert_accepted(
        source="point",
        node_key="0192f0c0-0000-7000-8000-0000000000ff:never_created",
    )


def test_a_point_column_without_a_node_key_is_rejected() -> None:
    with pytest.raises(DatasetColumnInvalid) as raised:
        check_point_binding(source="point", node_key=None)

    assert _fields(raised.value) == ["node_key"]


def test_a_point_column_with_a_malformed_node_key_is_rejected() -> None:
    with pytest.raises(DatasetColumnInvalid) as raised:
        check_point_binding(source="point", node_key="没有冒号")

    assert _fields(raised.value) == ["node_key"]


def _fields(error: DatasetColumnInvalid) -> list[str]:
    """取出这次拒绝指到了哪几个输入框。"""
    details: tuple[FieldError, ...] = error.details
    return [item.field for item in details]
