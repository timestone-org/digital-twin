"""protocol → 驱动工厂。**新增一种协议只在这里加一行。**

计划侧只认识 protocol 这个字符串，不认识任何驱动类型（ADR-0011）。
"""

from collections.abc import Callable, Mapping

from collector_server.apps.collect.drivers.base import Driver, DriverConnection
from collector_server.apps.collect.drivers.opcua.driver import OpcuaDriver
from collector_server.apps.collect.errors import UnknownProtocol

DriverFactory = Callable[[DriverConnection], Driver]

# ⚠ 取值是字符串常量，与计划里的 `protocol` 逐字一致（禁数字枚举）
PROTOCOL_OPCUA = "opcua"


def _build_opcua(connection: DriverConnection) -> Driver:
    return OpcuaDriver(connection=connection)


_FACTORIES: Mapping[str, DriverFactory] = {PROTOCOL_OPCUA: _build_opcua}


def supported_protocols() -> tuple[str, ...]:
    """已实现的协议名，按字典序。"""
    return tuple(sorted(_FACTORIES))


def create_driver(protocol: str, connection: DriverConnection) -> Driver:
    """按协议名造驱动；没有实现就抛，绝不静默给一个什么都不干的驱动。

    Args: protocol, connection。
    """
    factory = _FACTORIES.get(protocol)
    if factory is None:
        raise UnknownProtocol(f"没有实现这种协议的驱动：{protocol}")
    return factory(connection)
