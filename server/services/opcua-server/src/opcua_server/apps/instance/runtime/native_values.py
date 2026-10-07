"""自定义地址空间的原生写值限制；权限仍由 asyncua 执行。"""

from collections.abc import Callable

from asyncua import ua
from asyncua.crypto.permission_rules import User, UserRole

from opcua_server.apps.instance.errors import NodeValueRejected
from opcua_server.apps.instance.runtime.addressspace import (
    CUSTOM_NAMESPACE_INDEX,
)
from opcua_server.apps.instance.runtime.datatypes import coerce, variant_type

ReadAttribute = Callable[[ua.NodeId, ua.AttributeIds], ua.DataValue]
CURRENT_WRITE_MASK = 1 << int(ua.AccessLevel.CurrentWrite)


class NativeValuePolicy:
    """只限制本项目浮点节点的 Value 写入，不改变上游权限结果。"""

    def __init__(self, read_attribute: ReadAttribute) -> None:
        self._read_attribute = read_attribute

    def rejection(
        self, item: ua.WriteValue, user: User | None
    ) -> ua.StatusCode | None:
        """取有限值限制的拒绝状态，其余交给上游。Args: item, user。"""
        data_type = self._data_type(item)
        if data_type is None:
            return None
        if (
            user is None or user.role != UserRole.Admin
        ) and not self._is_writable(item.NodeId):
            return None
        value = item.Value
        if value.StatusCode is not None and value.StatusCode.is_bad():
            return None
        variant = value.Value
        if variant is None or variant.VariantType != variant_type(data_type):
            return None
        try:
            coerce(variant.Value, data_type)
        except NodeValueRejected:
            return ua.StatusCode(ua.UInt32(ua.StatusCodes.BadOutOfRange))
        return None

    def _data_type(self, item: ua.WriteValue) -> str | None:
        if (
            item.NodeId.NamespaceIndex != CUSTOM_NAMESPACE_INDEX
            or item.AttributeId != ua.AttributeIds.Value
        ):
            return None
        value = self._read_attribute(item.NodeId, ua.AttributeIds.DataType)
        if value.StatusCode is None or not value.StatusCode.is_good():
            return None
        identifier = value.Value.Value if value.Value is not None else None
        if (
            not isinstance(identifier, ua.NodeId)
            or identifier.NamespaceIndex != 0
        ):
            return None
        if identifier.Identifier == ua.ObjectIds.Float:
            return "float"
        if identifier.Identifier == ua.ObjectIds.Double:
            return "double"
        return None

    def _is_writable(self, node_id: ua.NodeId) -> bool:
        attributes = (
            ua.AttributeIds.AccessLevel,
            ua.AttributeIds.UserAccessLevel,
        )
        return all(
            _has_current_write(self._read_attribute(node_id, attribute))
            for attribute in attributes
        )


def _has_current_write(value: ua.DataValue) -> bool:
    if value.StatusCode is None or not value.StatusCode.is_good():
        return False
    flags = value.Value.Value if value.Value is not None else None
    return isinstance(flags, int) and bool(flags & CURRENT_WRITE_MASK)
