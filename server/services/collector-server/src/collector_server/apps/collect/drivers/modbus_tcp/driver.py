"""只读 Modbus TCP 驱动；第三方协议知识止于本目录。"""

import asyncio
import ipaddress
from collections.abc import Awaitable, Sequence
from typing import Any, Protocol, cast
from urllib.parse import urlsplit

from pymodbus.client import AsyncModbusTcpClient
from pymodbus.exceptions import ModbusException

from collector_server.apps.collect.drivers.base import (
    BrowseItem,
    BrowseNotSupported,
    DriverCapabilities,
    DriverConnection,
    DriverNotConnected,
    ErrorCategory,
    PointSpec,
    Sample,
    SubscribeResult,
    ValueSink,
    WriteNotSupported,
)
from collector_server.apps.collect.drivers.modbus_tcp.address import (
    AddressInvalid,
    ModbusPoint,
    parse_point,
)
from collector_server.apps.collect.drivers.modbus_tcp.batching import (
    ReadBatch,
    build_batches,
)
from collector_server.apps.collect.drivers.modbus_tcp.mapping import (
    Order,
    decode_registers,
)
from collector_server.clock import utc_now_ms
from lib.logging import get_logger

CAPABILITIES = DriverCapabilities(
    is_subscribe_supported=False,
    is_browse_supported=False,
    is_write_supported=False,
    minimum_poll_interval_ms=1000,
    is_empty_source_connection_supported=False,
)
MAX_REGISTERS = 125
MAX_BITS = 2000
KNOWN_OPTIONS = frozenset(
    {
        "byte_order",
        "device_id",
        "max_bits_per_request",
        "max_registers_per_request",
        "max_requests_per_cycle",
        "word_order",
    }
)
_logger = get_logger("collect.modbus_tcp")


class ModbusClient(Protocol):
    """驱动用到的最小异步客户端面。"""

    async def connect(self) -> bool: ...

    def close(self) -> None: ...

    def read_coils(self, address: int, **kwargs: object) -> Awaitable[Any]: ...

    def read_discrete_inputs(
        self, address: int, **kwargs: object
    ) -> Awaitable[Any]: ...

    def read_holding_registers(
        self, address: int, **kwargs: object
    ) -> Awaitable[Any]: ...

    def read_input_registers(
        self, address: int, **kwargs: object
    ) -> Awaitable[Any]: ...


def build_client(connection: DriverConnection) -> ModbusClient:
    """按严格 endpoint 构造禁重试客户端。

    Args: connection。
    """
    host, port = _authorized_target(connection)
    return cast(
        ModbusClient,
        AsyncModbusTcpClient(
            host,
            port=port,
            timeout=connection.timeouts.request_s,
            retries=0,
            reconnect_delay=0,
        ),
    )


def _authorized_target(connection: DriverConnection) -> tuple[str, int]:
    host, port, target = _endpoint(connection.endpoint)
    try:
        ipaddress.ip_address(host)
    except ValueError as error:
        raise AddressInvalid("Modbus TCP 目标必须是明确的 IP 地址") from error
    if not connection.is_network_access_enabled:
        raise AddressInvalid("PLC 只读采集未在采集进程启用")
    if target not in connection.allowed_endpoints:
        raise AddressInvalid("PLC 目标未列入采集进程白名单")
    return host, port


def _endpoint(value: str) -> tuple[str, int, str]:
    endpoint = urlsplit(value)
    if (
        endpoint.scheme != "modbus.tcp"
        or endpoint.hostname is None
        or endpoint.username is not None
        or endpoint.password is not None
        or endpoint.path not in ("", "/")
        or endpoint.query
        or endpoint.fragment
    ):
        raise AddressInvalid("Endpoint 必须是 modbus.tcp://host:port")
    try:
        port = endpoint.port
    except ValueError as error:
        raise AddressInvalid("Modbus TCP 端口不合法") from error
    if port is None:
        raise AddressInvalid("Modbus TCP Endpoint 必须明确指定端口")
    return endpoint.hostname, port, endpoint.netloc


class ModbusTcpDriver:
    """每个数据源一条连接、同一连接最多一个在途读请求。"""

    def __init__(
        self,
        *,
        connection: DriverConnection,
        client: ModbusClient | None = None,
    ) -> None:
        self._connection = connection
        self._options = _options(connection)
        # ⚠ pymodbus 的异步客户端构造器要求已有运行中的事件循环。
        self._client = client
        self._points: dict[str, ModbusPoint] = {}
        self._io_lock = asyncio.Lock()
        self._last_transport_error: BaseException | None = None
        self._is_revoked = False
        self._next_batch_index = 0

    def revoke(self) -> None:
        """租约失效时立即阻止后续 PLC 请求。"""
        self._is_revoked = True

    @property
    def capabilities(self) -> DriverCapabilities:
        return CAPABILITIES

    def load_points(self, points: Sequence[PointSpec]) -> int:
        parsed: dict[str, ModbusPoint] = {}
        for point in points:
            try:
                resolved = parse_point(point)
                limit = (
                    self._options.max_bits
                    if resolved.area in ("coil", "discrete")
                    else self._options.max_registers
                )
                if resolved.width > limit:
                    raise AddressInvalid("点位宽度超过单次读取上限")
                parsed[point.point_code] = resolved
            except AddressInvalid:
                _logger.error(
                    "modbus_point_rejected",
                    "Modbus TCP 点位寻址串不合法，该点将上报 bad 质量",
                    point_code=point.point_code,
                )
        self._points = parsed
        return len(parsed)

    async def connect(self) -> None:
        if self._is_revoked:
            raise DriverNotConnected("采集租约已经失效")
        _authorized_target(self._connection)
        if self._connection.username or self._connection.password:
            raise AddressInvalid("Modbus TCP 首版不接受账号口令")
        if self._client is None:
            self._client = build_client(self._connection)
        limiter = self._connection.request_limiter
        acquired = False
        try:
            if limiter is not None:
                await limiter.acquire()
                acquired = True
            if self._is_revoked:
                raise DriverNotConnected("采集租约已经失效")
            async with asyncio.timeout(self._connection.timeouts.connect_s):
                if not await self._client.connect():
                    raise ConnectionError("Modbus TCP 连接失败")
        except BaseException:
            self._client.close()
            self._client = None
            raise
        finally:
            if limiter is not None and acquired:
                limiter.release()
        self._last_transport_error = None

    async def disconnect(self) -> None:
        if self._client is not None:
            self._client.close()

    async def healthcheck(self) -> None:
        if self._last_transport_error is not None:
            error, self._last_transport_error = self._last_transport_error, None
            raise error
        if self._client is None or not is_client_connected(self._client):
            raise DriverNotConnected("Modbus TCP 连接已断开")

    async def subscribe(
        self, points: Sequence[PointSpec], on_value: ValueSink
    ) -> SubscribeResult:
        del points, on_value
        raise BrowseNotSupported("Modbus TCP 不支持订阅")

    async def unsubscribe(self, point_codes: Sequence[str]) -> int:
        del point_codes
        return 0

    async def read_many(self, point_codes: Sequence[str]) -> list[Sample]:
        now = utc_now_ms()
        result: dict[str, Sample] = dict.fromkeys(
            point_codes, (None, now, "bad")
        )
        selected = [
            self._points[code] for code in point_codes if code in self._points
        ]
        batches = build_batches(
            selected,
            max_registers=self._options.max_registers,
            max_bits=self._options.max_bits,
        )
        if not batches:
            return [result[code] for code in point_codes]
        start = self._next_batch_index % len(batches)
        limited = min(len(batches), self._options.max_requests_per_cycle)
        selected_batches = (batches[start:] + batches[:start])[:limited]
        self._next_batch_index = (start + limited) % len(batches)
        if limited < len(batches):
            _logger.warning(
                "modbus_cycle_overloaded",
                "PLC 读取批次超过单轮预算，未读点位标为 bad",
                batch_count=len(batches),
                budget=limited,
            )
        for batch in selected_batches:
            await self._read_into(batch, result)
        return [result[code] for code in point_codes]

    async def write(self, point_code: str, value: object) -> None:
        del point_code, value
        raise WriteNotSupported("Modbus TCP 采集驱动只读")

    async def browse(self, parent: str | None) -> list[BrowseItem]:
        del parent
        raise BrowseNotSupported("Modbus 没有可浏览的地址空间")

    def fingerprint(self) -> tuple[str, ...]:
        return (
            self._connection.endpoint,
            *(
                f"{key}={value}"
                for key, value in sorted(self._connection.options.items())
            ),
        )

    def classify_error(self, error: BaseException) -> ErrorCategory:
        if isinstance(error, (AddressInvalid, ValueError)):
            return "config"
        return "transient"

    async def _read_into(
        self, batch: ReadBatch, result: dict[str, Sample]
    ) -> None:
        try:
            response = await self._bounded_request(batch)
            values = _response_values(response, batch.area)
            now = utc_now_ms()
            for point in batch.points:
                start = point.offset - batch.offset
                try:
                    value = _decode(point, values, start, self._options)
                except (OverflowError, ValueError):
                    continue
                result[point.point_code] = (value, now, "good")
        except (ModbusException, OSError, TimeoutError) as error:
            self._last_transport_error = error
        except ValueError:
            return

    async def _bounded_request(self, batch: ReadBatch) -> Any:
        async with self._io_lock:
            limiter = self._connection.request_limiter
            if limiter is not None:
                await limiter.acquire()
            try:
                if self._is_revoked:
                    raise DriverNotConnected("采集租约已经失效")
                return await asyncio.wait_for(
                    self._request(batch),
                    timeout=self._connection.timeouts.request_s,
                )
            finally:
                if limiter is not None:
                    limiter.release()

    def _request(self, batch: ReadBatch) -> Awaitable[Any]:
        if self._client is None:
            raise DriverNotConnected("Modbus TCP 连接尚未建立")
        args = {
            "count": batch.count,
            "device_id": self._options.device_id,
        }
        if batch.area == "coil":
            return self._client.read_coils(batch.offset, **args)
        if batch.area == "discrete":
            return self._client.read_discrete_inputs(batch.offset, **args)
        if batch.area == "holding":
            return self._client.read_holding_registers(batch.offset, **args)
        return self._client.read_input_registers(batch.offset, **args)


class _Options:
    def __init__(self, connection: DriverConnection) -> None:
        options = connection.options
        unknown = sorted(set(options) - KNOWN_OPTIONS)
        if unknown:
            raise AddressInvalid(
                f"未知 Modbus TCP 连接参数：{', '.join(unknown)}"
            )
        self.device_id = _integer(options, "device_id", 1, 0, 247)
        self.max_registers = _integer(
            options, "max_registers_per_request", 120, 1, MAX_REGISTERS
        )
        self.max_bits = _integer(
            options, "max_bits_per_request", 512, 1, MAX_BITS
        )
        self.max_requests_per_cycle = _integer(
            options, "max_requests_per_cycle", 2, 1, 8
        )
        self.byte_order: Order = _order(options.get("byte_order", "big"))
        self.word_order: Order = _order(options.get("word_order", "big"))


def _options(connection: DriverConnection) -> _Options:
    return _Options(connection)


def _integer(
    options: object, key: str, default: int, minimum: int, maximum: int
) -> int:
    mapping = cast(dict[str, str], options)
    try:
        value = int(mapping.get(key, str(default)))
    except ValueError as error:
        raise AddressInvalid(f"{key} 必须是整数") from error
    if not minimum <= value <= maximum:
        raise AddressInvalid(f"{key} 超出允许范围")
    return value


def _order(value: str) -> Order:
    if value == "big":
        return "big"
    if value == "little":
        return "little"
    raise AddressInvalid("byte_order/word_order 只能是 big 或 little")


def _response_values(response: Any, area: str) -> list[int] | list[bool]:
    if bool(response.isError()):
        raise ValueError("PLC 返回 Modbus 异常响应")
    raw = response.bits if area in ("coil", "discrete") else response.registers
    if not isinstance(raw, list):
        raise ValueError("PLC 返回了未知响应形状")
    return cast(list[int] | list[bool], raw)


def is_client_connected(client: object) -> bool:
    """收窄 pymodbus 没有协议类型的连接状态属性。

    Args: client。
    """
    return bool(getattr(client, "connected", False))


def _decode(
    point: ModbusPoint,
    values: list[int] | list[bool],
    start: int,
    options: _Options,
) -> object:
    if point.kind == "bool":
        if start >= len(values):
            raise ValueError("Modbus 位响应数量不足")
        return bool(values[start])
    registers = [int(value) for value in values[start : start + point.width]]
    return decode_registers(
        point,
        registers,
        byte_order=options.byte_order,
        word_order=options.word_order,
    )
