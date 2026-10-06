"""命令执行消耗剩余 deadline 预算，超期会取消现场往返。"""

import asyncio
from uuid import UUID

import pytest

from collector_server.apps.collect.bus.consumer import CommandConsumer
from collector_server.apps.collect.drivers.base import Driver
from unit.http_driver_fakes import GatedHandler, RecordingHandler, driver_for
from unit.test_bus_consumer import FakeLocator, FakeSession, FakeTransport

SOURCE_ID = "0192f000-0000-7000-8000-000000000001"
NOW_MS = 1787544300000


@pytest.mark.parametrize("action", ["read", "write", "browse"])
async def test_inflight_command_is_cancelled_at_its_deadline(
    driver: Driver, monkeypatch: pytest.MonkeyPatch, action: str
) -> None:
    cancelled = asyncio.Event()

    async def block(*_: object, **__: object) -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    for operation in ("read_many", "write", "browse"):
        monkeypatch.setattr(driver, operation, block)
    transport = FakeTransport(
        [
            {
                "request_id": "deadline-test",
                "action": action,
                "source_id": SOURCE_ID,
                "deadline_ms": NOW_MS + 10,
                "point_codes": ["value"],
                "point_code": "value",
                "value": 1,
            }
        ]
    )
    locator = FakeLocator({})
    locator.sessions[UUID(SOURCE_ID)] = FakeSession(driver)
    consumer = CommandConsumer(
        transport=transport,
        locator=locator,
        block_s=0.01,
        reply_ttl_s=60,
        clock=lambda: NOW_MS,
    )
    assert await asyncio.wait_for(consumer.handle_once(), timeout=0.15) is True
    assert cancelled.is_set() is True
    assert transport.replies[0][1]["status"] == "error"
    assert transport.replies[0][1]["detail"] == "TimeoutError"


async def test_expired_command_does_not_start_a_driver_request(
    driver: Driver, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []

    async def read(*_: object) -> None:
        calls.append("read")

    monkeypatch.setattr(driver, "read_many", read)
    transport = FakeTransport(
        [
            {
                "request_id": "expired-test",
                "action": "read",
                "source_id": SOURCE_ID,
                "deadline_ms": NOW_MS,
                "point_codes": ["value"],
            }
        ]
    )
    consumer = CommandConsumer(
        transport=transport,
        locator=FakeLocator({UUID(SOURCE_ID): FakeSession(driver)}),
        block_s=0.01,
        reply_ttl_s=60,
        clock=lambda: NOW_MS,
    )
    assert await consumer.handle_once() is True
    assert calls == []
    assert transport.replies == []


def _read_request(request_id: str, source_id: str) -> dict[str, object]:
    return {
        "request_id": request_id,
        "action": "read",
        "source_id": source_id,
        "deadline_ms": NOW_MS + 1000,
        "point_codes": ["value"],
    }


async def test_revocation_keeps_the_command_consumer_alive() -> None:
    handler = GatedHandler()
    revoked = driver_for(handler)
    healthy = driver_for(RecordingHandler())
    second_id = "0192f000-0000-7000-8000-000000000002"
    transport = FakeTransport(
        [_read_request("first", SOURCE_ID), _read_request("second", second_id)]
    )
    locator = FakeLocator(
        {
            UUID(SOURCE_ID): FakeSession(revoked),
            UUID(second_id): FakeSession(healthy),
        }
    )
    consumer = CommandConsumer(
        transport=transport,
        locator=locator,
        block_s=0.01,
        reply_ttl_s=60,
        clock=lambda: NOW_MS,
    )
    await revoked.connect()
    await healthy.connect()
    task = asyncio.create_task(consumer.handle_once())
    try:
        await handler.entered.get()
        revoked.revoke()
        assert await asyncio.wait_for(task, timeout=0.2) is True
        assert await consumer.handle_once() is True
        assert [reply[1]["status"] for reply in transport.replies] == [
            "error",
            "ok",
        ]
        assert transport.replies[0][1]["reason"] == "driver_not_connected"
        assert handler.cancelled.is_set() is True
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await revoked.disconnect()
        await healthy.disconnect()
