"""只读 Modbus TCP 采集驱动。"""

from collector_server.apps.collect.drivers.modbus_tcp.driver import (
    ModbusTcpDriver,
)

__all__ = ["ModbusTcpDriver"]
