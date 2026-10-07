"""原生有限值限制只覆盖本项目的可写浮点 Value 属性。"""

from dataclasses import replace

import pytest
from asyncua import ua
from asyncua.crypto.permission_rules import User, UserRole

from opcua_server.apps.instance.runtime.native_values import NativeValuePolicy


class AttributeReader:
    def __init__(self) -> None:
        self.attributes = {
            ua.AttributeIds.DataType: ua.DataValue(
                ua.Variant(
                    ua.NodeId(ua.ObjectIds.Double), ua.VariantType.NodeId
                )
            ),
            ua.AttributeIds.AccessLevel: ua.DataValue(
                ua.Variant(3, ua.VariantType.Byte)
            ),
            ua.AttributeIds.UserAccessLevel: ua.DataValue(
                ua.Variant(3, ua.VariantType.Byte)
            ),
        }

    def read(
        self, _node_id: ua.NodeId, attribute: ua.AttributeIds
    ) -> ua.DataValue:
        return self.attributes[attribute]


def _item(value: object = float("nan")) -> ua.WriteValue:
    return ua.WriteValue(
        NodeId_=ua.NodeId("value", 2),
        AttributeId=ua.AttributeIds.Value,
        Value=ua.DataValue(ua.Variant(value, ua.VariantType.Double)),
    )


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_writable_custom_nonfinite_value_is_rejected(value: float) -> None:
    policy = NativeValuePolicy(AttributeReader().read)
    result = policy.rejection(_item(value), User(role=UserRole.Anonymous))
    assert result is not None
    assert result.value == ua.StatusCodes.BadOutOfRange


def test_finite_value_is_delegated_to_upstream() -> None:
    policy = NativeValuePolicy(AttributeReader().read)
    assert policy.rejection(_item(7.5), User(role=UserRole.Anonymous)) is None


@pytest.mark.parametrize(
    "attribute", [ua.AttributeIds.AccessLevel, ua.AttributeIds.UserAccessLevel]
)
@pytest.mark.parametrize(
    "value",
    [
        ua.DataValue(ua.Variant(1, ua.VariantType.Byte)),
        ua.DataValue(
            StatusCode_=ua.StatusCode(ua.StatusCodes.BadAttributeIdInvalid)
        ),
        ua.DataValue(Value=None),
        ua.DataValue(StatusCode_=None),
    ],
)
def test_permission_failures_are_left_to_upstream(
    attribute: ua.AttributeIds, value: ua.DataValue
) -> None:
    reader = AttributeReader()
    reader.attributes[attribute] = value
    policy = NativeValuePolicy(reader.read)
    assert policy.rejection(_item(), User(role=UserRole.Anonymous)) is None


def test_admin_retains_upstream_access_privileges() -> None:
    reader = AttributeReader()
    reader.attributes[ua.AttributeIds.AccessLevel] = ua.DataValue(
        ua.Variant(1, ua.VariantType.Byte)
    )
    policy = NativeValuePolicy(reader.read)
    result = policy.rejection(_item(), User(role=UserRole.Admin))
    assert result is not None
    assert result.value == ua.StatusCodes.BadOutOfRange


@pytest.mark.parametrize(
    ("node_id", "attribute"),
    [
        (ua.NodeId("value", 0), ua.AttributeIds.Value),
        (ua.NodeId("value", 2), ua.AttributeIds.Description),
    ],
)
def test_standard_namespace_and_non_value_attributes_are_delegated(
    node_id: ua.NodeId, attribute: ua.AttributeIds
) -> None:
    item = replace(_item(), NodeId_=node_id, AttributeId=attribute)
    assert (
        NativeValuePolicy(AttributeReader().read).rejection(item, None) is None
    )


@pytest.mark.parametrize(
    "value",
    [
        ua.DataValue(
            StatusCode_=ua.StatusCode(ua.StatusCodes.BadNodeIdUnknown)
        ),
        ua.DataValue(Value=None),
        ua.DataValue(ua.Variant("invalid")),
        ua.DataValue(ua.Variant(ua.NodeId(10, 2), ua.VariantType.NodeId)),
        ua.DataValue(
            ua.Variant(ua.NodeId(ua.ObjectIds.String), ua.VariantType.NodeId)
        ),
    ],
)
def test_unknown_nodes_and_other_data_types_are_delegated(
    value: ua.DataValue,
) -> None:
    reader = AttributeReader()
    reader.attributes[ua.AttributeIds.DataType] = value
    assert NativeValuePolicy(reader.read).rejection(_item(), None) is None


def test_bad_status_value_is_ignored_by_the_upstream_policy() -> None:
    item = _item()
    item = replace(
        item,
        Value=replace(
            item.Value, StatusCode_=ua.StatusCode(ua.StatusCodes.BadNoData)
        ),
    )
    assert (
        NativeValuePolicy(AttributeReader().read).rejection(item, None) is None
    )


def test_variant_type_mismatch_is_delegated_to_upstream() -> None:
    item = replace(
        _item(),
        Value=ua.DataValue(ua.Variant(float("nan"), ua.VariantType.Float)),
    )
    assert (
        NativeValuePolicy(AttributeReader().read).rejection(item, None) is None
    )
