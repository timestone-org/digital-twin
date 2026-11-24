"""守 OPC UA 订阅坏质量与主动读值恢复不一致时的会话恢复。"""

import asyncio
from dataclasses import dataclass
from uuid import UUID

import pytest
from asyncua import ua

from collector_server.apps.collect.drivers.base import (
    DriverNotConnected,
    Sample,
)
from collector_server.apps.collect.drivers.opcua import recovery
from collector_server.apps.collect.runtime.session import (
    SessionOptions,
    SourceSession,
    SourceStatus,
)
from collectwire import PlanPoint, PlanSource
from timeseries import Quality
from unit.opcua_driver_fakes import (
    MAX_NODES,
    FakeClient,
    make_driver,
    make_spec,
)

POINT_CODE = "inverter"
ADDRESS = "ns=2;s=inverter"
GOOD_ZERO = ua.DataValue(Value=ua.Variant(0.0))
BAD = ua.DataValue(StatusCode_=ua.StatusCode(ua.StatusCodes.BadNoCommunication))


@dataclass
class RecoveryClock:
    """只推进订阅恢复的单调时钟。"""

    now_s: float = 100.0

    def now(self) -> float:
        return self.now_s

    def advance(self, seconds: float) -> None:
        self.now_s += seconds


class StatusRecorder:
    """记录同一数据源会话的运行态。"""

    def __init__(self) -> None:
        self.statuses: list[SourceStatus] = []

    async def report(self, status: SourceStatus) -> None:
        self.statuses.append(status)


@pytest.fixture
def recovery_clock(monkeypatch: pytest.MonkeyPatch) -> RecoveryClock:
    clock = RecoveryClock()
    monkeypatch.setattr(recovery, "monotonic", clock.now)
    return clock


@pytest.fixture
def opcua_source() -> PlanSource:
    return PlanSource(
        source_id=UUID(int=1),
        code="photovoltaic",
        protocol="opcua",
        endpoint="opc.tcp://127.0.0.1:4840/x",
        points=(
            PlanPoint(
                point_code=POINT_CODE,
                address=ADDRESS,
                sampling_interval_ms=1000,
            ),
        ),
    )


async def test_heartbeat_recovers_a_stuck_bad_subscription(
    recovery_clock: RecoveryClock,
) -> None:
    driver, clients = make_driver()
    await driver.connect()
    try:
        await driver.subscribe([make_spec(POINT_CODE)], lambda *_: None)
        client = clients[0]
        client.values[ADDRESS] = GOOD_ZERO
        client.asked.clear()

        recovery_clock.advance(10)
        await driver.healthcheck()
        assert client.asked == []

        client.subscription.notify(client.built[ADDRESS], BAD)
        recovery_clock.advance(21)
        with pytest.raises(DriverNotConnected):
            await driver.healthcheck()
        assert client.asked == [(int(ua.AttributeIds.Value), [ADDRESS])]
    finally:
        await driver.disconnect()


@pytest.mark.parametrize(
    "reading",
    [
        BAD,
        ua.DataValue(
            Value=ua.Variant(1.0),
            StatusCode_=ua.StatusCode(ua.StatusCodes.Uncertain),
        ),
        ua.DataValue(),
        ua.DataValue(Value=ua.Variant(float("nan"))),
        TimeoutError(),
    ],
    ids=["still-bad", "uncertain", "null", "non-finite", "timeout"],
)
async def test_unusable_probe_does_not_reconnect_a_source(
    recovery_clock: RecoveryClock, reading: ua.DataValue | TimeoutError
) -> None:
    driver, clients = make_driver()
    seen: list[Sample] = []
    await driver.connect()
    try:
        await driver.subscribe(
            [make_spec(POINT_CODE)],
            lambda _code, value, stamp, quality: seen.append(
                (value, stamp, quality)
            ),
        )
        client = clients[0]
        if isinstance(reading, TimeoutError):
            client.read_errors[ADDRESS] = reading
        else:
            client.values[ADDRESS] = reading
        client.asked.clear()
        recovery_clock.advance(31)
        await driver.healthcheck()
        assert len(seen) == 1
        assert seen[0][2] == "bad"
        assert client.asked == [(int(ua.AttributeIds.Value), [ADDRESS])]
        assert client.is_connected
    finally:
        await driver.disconnect()


async def test_notification_during_probe_cancels_a_recovery_decision(
    recovery_clock: RecoveryClock,
) -> None:
    driver, clients = make_driver()
    await driver.connect()
    try:
        await driver.subscribe([make_spec(POINT_CODE)], lambda *_: None)
        client = clients[0]
        client.values[ADDRESS] = GOOD_ZERO

        def recover_then_fail_again() -> None:
            node = client.built[ADDRESS]
            client.subscription.notify(node, GOOD_ZERO)
            client.subscription.notify(node, BAD)

        client.on_read = recover_then_fail_again
        recovery_clock.advance(31)
        await driver.healthcheck()
        assert client.is_connected
        client.on_read = None
        client.asked.clear()
        await driver.healthcheck()
        assert client.asked == []
    finally:
        await driver.disconnect()


async def test_probes_rotate_through_bad_points_in_bounded_batches(
    recovery_clock: RecoveryClock,
) -> None:
    driver, clients = make_driver()
    await driver.connect()
    try:
        specs = [make_spec(f"point_{index}") for index in range(MAX_NODES + 1)]
        await driver.subscribe(specs, lambda *_: None)
        client = clients[0]
        last_address = specs[-1].address
        client.values[last_address] = GOOD_ZERO
        client.asked.clear()
        recovery_clock.advance(31)
        await driver.healthcheck()
        with pytest.raises(DriverNotConnected):
            await driver.healthcheck()
        assert [len(addresses) for _, addresses in client.asked] == [
            MAX_NODES,
            MAX_NODES,
        ]
        assert last_address not in client.asked[0][1]
        assert client.asked[1][1][0] == last_address
    finally:
        await driver.disconnect()


async def test_cooldown_survives_source_reconnect(
    recovery_clock: RecoveryClock,
) -> None:
    driver, clients = make_driver()
    try:
        await driver.connect()
        await driver.subscribe([make_spec(POINT_CODE)], lambda *_: None)
        clients[0].values[ADDRESS] = GOOD_ZERO
        recovery_clock.advance(31)
        with pytest.raises(DriverNotConnected):
            await driver.healthcheck()
        await driver.disconnect()

        await driver.connect()
        await driver.subscribe([make_spec(POINT_CODE)], lambda *_: None)
        clients[1].values[ADDRESS] = GOOD_ZERO
        clients[1].asked.clear()
        recovery_clock.advance(31)
        await driver.healthcheck()
        assert clients[1].asked == []
        recovery_clock.advance(90)
        with pytest.raises(DriverNotConnected):
            await driver.healthcheck()
        assert len(clients[1].asked) == 1
    finally:
        await driver.disconnect()


async def test_source_session_reconnects_and_emits_the_recovered_value(
    recovery_clock: RecoveryClock, opcua_source: PlanSource
) -> None:
    was_bad = asyncio.Event()
    recovered = asyncio.Event()
    is_field_healthy = False

    def prepare(client: FakeClient) -> None:
        if is_field_healthy:
            client.values[ADDRESS] = GOOD_ZERO

    def sink(code: str, value: object, _stamp: int, quality: Quality) -> None:
        if code == POINT_CODE and quality == "bad":
            was_bad.set()
        if code == POINT_CODE and value == 0.0 and quality == "good":
            recovered.set()

    driver, clients = make_driver(prepare=prepare)
    reporter = StatusRecorder()
    session = SourceSession(
        source=opcua_source,
        driver=driver,
        sink=sink,
        options=SessionOptions(heartbeat_interval_s=0.01, max_backoff_s=0.0),
        reporter=reporter,
    )
    task = asyncio.create_task(session.run())
    try:
        await asyncio.wait_for(was_bad.wait(), timeout=2)
        is_field_healthy = True
        clients[0].values[ADDRESS] = GOOD_ZERO
        recovery_clock.advance(31)
        await asyncio.wait_for(recovered.wait(), timeout=2)
        assert len(clients) == 2
        assert not clients[0].is_connected
        assert clients[1].subscription.handles == [1]
        assert any(status.state == "offline" for status in reporter.statuses)
        assert session.is_online
    finally:
        await session.stop()
        await asyncio.wait_for(task, timeout=2)
