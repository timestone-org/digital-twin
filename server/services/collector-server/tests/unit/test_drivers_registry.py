"""守驱动注册表：认识的协议造得出驱动，不认识的**响亮失败**。

⚠ 静默给一个什么都不干的驱动，表现是「配置好了但永远没有数据」。
"""

import pytest

from collector_server.apps.collect.drivers.base import DriverConnection
from collector_server.apps.collect.drivers.modbus_tcp.driver import (
    ModbusTcpDriver,
)
from collector_server.apps.collect.drivers.opcua.driver import OpcuaDriver
from collector_server.apps.collect.drivers.registry import (
    PROTOCOL_MODBUS_TCP,
    PROTOCOL_OPCUA,
    create_driver,
    supported_protocols,
)
from collector_server.apps.collect.errors import UnknownProtocol

CONNECTION = DriverConnection(endpoint="opc.tcp://127.0.0.1:4840/x")


def test_supported_protocols_are_explicit() -> None:
    assert supported_protocols() == ("modbus_tcp", "opcua")


def test_opcua_protocol_builds_the_opcua_driver() -> None:
    assert isinstance(create_driver(PROTOCOL_OPCUA, CONNECTION), OpcuaDriver)


def test_modbus_tcp_protocol_builds_a_read_only_driver() -> None:
    connection = DriverConnection(endpoint="modbus.tcp://127.0.0.1:502")
    assert isinstance(
        create_driver(PROTOCOL_MODBUS_TCP, connection), ModbusTcpDriver
    )


def test_unknown_protocol_is_refused() -> None:
    with pytest.raises(UnknownProtocol) as raised:
        create_driver("s7", CONNECTION)
    assert raised.value.reason == "unknown_protocol"
