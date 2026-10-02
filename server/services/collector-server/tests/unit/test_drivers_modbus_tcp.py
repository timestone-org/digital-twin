"""守只读 Modbus TCP 的地址、合批、解码与传输边界。"""

import asyncio
import struct
from typing import Any, cast

import pytest

from collector_server.apps.collect.drivers.base import (
    BrowseNotSupported,
    DriverConnection,
    DriverNotConnected,
    DriverTimeouts,
    PointSpec,
    WriteNotSupported,
)
from collector_server.apps.collect.drivers.modbus_tcp.address import (
    AddressInvalid,
    parse_point,
)
from collector_server.apps.collect.drivers.modbus_tcp.batching import (
    build_batches,
)
from collector_server.apps.collect.drivers.modbus_tcp.driver import (
    ModbusTcpDriver,
)
from collector_server.apps.collect.drivers.modbus_tcp.mapping import (
    decode_registers,
)
from collector_server.apps.collect.runtime.session import (
    SessionOptions,
    SourceSession,
)
from collectwire import DataType


def _spec(code: str, address: str, data_type: str = "float") -> PointSpec:
    return PointSpec(
        point_code=code,
        address=address,
        sampling_interval_ms=1000,
        data_type=cast(DataType, data_type),
    )


class Response:
    def __init__(
        self,
        *,
        registers: list[int] | None = None,
        bits: list[bool] | None = None,
        is_error: bool = False,
    ) -> None:
        self.registers = registers or []
        self.bits = bits or []
        self._is_error = is_error

    def is_error(self) -> bool:
        return self._is_error

    def __getattr__(self, name: str) -> object:
        if name == "isError":
            return self.is_error
        raise AttributeError(name)


class RecordingClient:
    connected = False

    def __init__(self, responses: list[Response]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, int, dict[str, object]]] = []
        self.active = 0
        self.peak_active = 0

    async def connect(self) -> bool:
        self.connected = True
        return True

    def close(self) -> None:
        self.connected = False

    def read_coils(self, address: int, **kwargs: object) -> Any:
        return self._read("coil", address, kwargs)

    def read_discrete_inputs(self, address: int, **kwargs: object) -> Any:
        return self._read("discrete", address, kwargs)

    def read_holding_registers(self, address: int, **kwargs: object) -> Any:
        return self._read("holding", address, kwargs)

    def read_input_registers(self, address: int, **kwargs: object) -> Any:
        return self._read("input", address, kwargs)

    async def _read(
        self, area: str, address: int, kwargs: dict[str, object]
    ) -> Response:
        self.calls.append((area, address, kwargs))
        self.active += 1
        self.peak_active = max(self.peak_active, self.active)
        await asyncio.sleep(0)
        self.active -= 1
        return self.responses.pop(0)


class TrackingLimiter:
    def __init__(self, limit: int) -> None:
        self._semaphore = asyncio.Semaphore(limit)
        self.active = 0
        self.peak_active = 0

    async def acquire(self) -> bool:
        await self._semaphore.acquire()
        self.active += 1
        self.peak_active = max(self.peak_active, self.active)
        return True

    def release(self) -> None:
        self.active -= 1
        self._semaphore.release()


def _driver(
    client: RecordingClient,
    limiter: TrackingLimiter | None = None,
    options: dict[str, str] | None = None,
) -> ModbusTcpDriver:
    return ModbusTcpDriver(
        connection=DriverConnection(
            endpoint="modbus.tcp://127.0.0.1:1502",
            options={"device_id": "7", **(options or {})},
            timeouts=DriverTimeouts(request_s=1),
            request_limiter=limiter,
            is_network_access_enabled=True,
            allowed_endpoints=frozenset({"127.0.0.1:1502"}),
        ),
        client=client,
    )


def test_addresses_are_zero_based_and_type_checked() -> None:
    parsed = parse_point(_spec("temperature", "holding:10:float32"))
    assert (parsed.offset, parsed.width, parsed.kind) == (10, 2, "float32")
    with pytest.raises(AddressInvalid):
        parse_point(_spec("wrong", "holding:40001:bool", "bool"))


def test_only_adjacent_approved_ranges_are_batched() -> None:
    points = [
        parse_point(_spec("a", "holding:0:uint16", "int")),
        parse_point(_spec("b", "holding:1:float32")),
        parse_point(_spec("c", "holding:4:uint16", "int")),
    ]
    batches = build_batches(points, max_registers=125, max_bits=2000)
    assert [(batch.offset, batch.count) for batch in batches] == [
        (0, 3),
        (4, 1),
    ]


def test_a_wide_value_cannot_exceed_the_configured_request_limit() -> None:
    point = parse_point(_spec("temp", "holding:1:float32"))
    with pytest.raises(AddressInvalid):
        build_batches([point], max_registers=1, max_bits=2000)


def test_register_decoding_honors_word_order() -> None:
    point = parse_point(_spec("temperature", "holding:0:float32"))
    high, low = struct.unpack(">HH", struct.pack(">f", 12.5))
    assert decode_registers(
        point, [low, high], byte_order="big", word_order="little"
    ) == pytest.approx(12.5)


def test_unknown_connection_option_is_rejected() -> None:
    with pytest.raises(AddressInvalid):
        ModbusTcpDriver(
            connection=DriverConnection(
                endpoint="modbus.tcp://127.0.0.1:502",
                options={"mystery": "on"},
            ),
            client=RecordingClient([]),
        )


async def test_reads_are_batched_aligned_and_read_only() -> None:
    client = RecordingClient([Response(registers=[7, 0x4148, 0x0000])])
    driver = _driver(client)
    driver.load_points(
        [
            _spec("count", "holding:0:uint16", "int"),
            _spec("temperature", "holding:1:float32"),
            _spec("invalid", "holding:2:bool", "bool"),
        ]
    )
    await driver.connect()
    samples = await driver.read_many(["temperature", "invalid", "count"])
    assert samples[0][0] == pytest.approx(12.5)
    assert samples[0][2] == "good"
    assert samples[1][2] == "bad"
    assert samples[2][0] == 7
    assert client.calls == [("holding", 0, {"count": 3, "device_id": 7})]
    with pytest.raises(WriteNotSupported):
        await driver.write("count", 9)
    with pytest.raises(BrowseNotSupported):
        await driver.browse(None)


async def test_failed_read_is_bad_and_next_read_recovers() -> None:
    client = RecordingClient([Response(is_error=True), Response(registers=[7])])
    driver = _driver(client)
    driver.load_points([_spec("count", "holding:0:uint16", "int")])
    await driver.connect()
    failed = await driver.read_many(["count"])
    recovered = await driver.read_many(["count"])
    assert failed[0][0] is None
    assert failed[0][2] == "bad"
    assert recovered[0][0] == 7
    assert recovered[0][2] == "good"


async def test_overloaded_batches_rotate_across_cycles() -> None:
    client = RecordingClient(
        [
            Response(registers=[1]),
            Response(registers=[2]),
            Response(registers=[3]),
        ]
    )
    driver = _driver(client, options={"max_requests_per_cycle": "1"})
    specs = [
        _spec(f"p{index}", f"holding:{index * 2}:uint16", "int")
        for index in range(3)
    ]
    driver.load_points(specs)
    await driver.connect()
    results = [await driver.read_many(["p0", "p1", "p2"]) for _ in range(3)]
    assert [[item[2] for item in samples] for samples in results] == [
        ["good", "bad", "bad"],
        ["bad", "good", "bad"],
        ["bad", "bad", "good"],
    ]
    assert [call[1] for call in client.calls] == [0, 2, 4]


async def test_one_invalid_decoding_does_not_discard_neighbor() -> None:
    client = RecordingClient([Response(registers=[7, 0x7F80, 0x0000])])
    driver = _driver(client)
    driver.load_points(
        [
            _spec("count", "holding:0:uint16", "int"),
            _spec("invalid_float", "holding:1:float32"),
        ]
    )
    await driver.connect()
    samples = await driver.read_many(["invalid_float", "count"])
    assert samples[0][2] == "bad"
    assert samples[1][0] == 7
    assert samples[1][2] == "good"


async def test_one_client_never_has_two_inflight_requests() -> None:
    client = RecordingClient([Response(registers=[1]), Response(registers=[1])])
    driver = _driver(client)
    driver.load_points([_spec("count", "holding:0:uint16", "int")])
    await driver.connect()
    await asyncio.gather(
        driver.read_many(["count"]), driver.read_many(["count"])
    )
    assert client.peak_active == 1


async def test_multiple_plcs_share_the_global_request_budget() -> None:
    limiter = TrackingLimiter(1)
    first = _driver(RecordingClient([Response(registers=[1])]), limiter)
    second = _driver(RecordingClient([Response(registers=[2])]), limiter)
    for driver in (first, second):
        driver.load_points([_spec("count", "holding:0:uint16", "int")])
        await driver.connect()
    await asyncio.gather(
        first.read_many(["count"]), second.read_many(["count"])
    )
    assert limiter.peak_active == 1


async def test_sixteen_plcs_progress_under_eight_request_slots() -> None:
    limiter = TrackingLimiter(8)
    drivers = [
        _driver(RecordingClient([Response(registers=[index])]), limiter)
        for index in range(16)
    ]
    for driver in drivers:
        driver.load_points([_spec("count", "holding:0:uint16", "int")])
        await driver.connect()
    results = await asyncio.gather(
        *(driver.read_many(["count"]) for driver in drivers)
    )
    assert [samples[0][0] for samples in results] == list(range(16))
    assert 1 < limiter.peak_active <= 8


async def test_default_policy_blocks_connect_before_network_io() -> None:
    client = RecordingClient([])
    driver = ModbusTcpDriver(
        connection=DriverConnection(endpoint="modbus.tcp://127.0.0.1:1502"),
        client=client,
    )
    with pytest.raises(AddressInvalid):
        await driver.connect()
    assert client.connected is False


async def test_all_invalid_points_do_not_open_a_plc_connection(
    build_source: Any, build_point: Any, reporter: Any
) -> None:
    client = RecordingClient([])
    session = SourceSession(
        source=build_source(
            protocol="modbus_tcp",
            points=(
                build_point(
                    "invalid", address="holding:0:bool", data_type="bool"
                ),
            ),
        ),
        driver=_driver(client),
        sink=lambda *_: None,
        options=SessionOptions(heartbeat_interval_s=10, max_backoff_s=60),
        reporter=reporter,
    )
    with pytest.raises(ValueError, match="没有可读取的有效点位"):
        await session._open()
    assert client.connected is False


async def test_revoked_driver_sends_no_further_requests() -> None:
    client = RecordingClient([Response(registers=[1])])
    driver = _driver(client)
    driver.load_points([_spec("count", "holding:0:uint16", "int")])
    await driver.connect()
    driver.revoke()
    with pytest.raises(DriverNotConnected):
        await driver.read_many(["count"])
    assert client.calls == []


async def test_revocation_while_waiting_for_capacity_blocks_connect() -> None:
    limiter = TrackingLimiter(1)
    await limiter.acquire()
    client = RecordingClient([])
    driver = _driver(client, limiter)
    pending = asyncio.create_task(driver.connect())
    await asyncio.sleep(0)
    driver.revoke()
    limiter.release()
    with pytest.raises(DriverNotConnected):
        await pending
    assert client.connected is False
