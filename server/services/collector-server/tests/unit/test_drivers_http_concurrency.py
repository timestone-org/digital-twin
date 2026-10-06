"""HTTP 每源单飞、全局并发预算、取消和租约撤销的顺序约束。"""

import asyncio

import pytest

from collector_server.apps.collect.drivers.base import DriverNotConnected
from collector_server.apps.collect.drivers.http.errors import HttpRequestFailed
from unit.http_driver_fakes import (
    NOW_MS,
    SECRET,
    TOKEN_ENDPOINT,
    USER,
    GatedHandler,
    HttpSetup,
    TrackingLimiter,
    driver_for,
)


async def test_simultaneous_reads_of_one_source_remain_single_flight() -> None:
    handler = GatedHandler()
    driver = driver_for(handler)
    await driver.connect()
    tasks = [asyncio.create_task(driver.read_many(["value"])) for _ in range(4)]
    try:
        await handler.entered.get()
        handler.released.set()
        assert await asyncio.gather(*tasks) == [[(21.5, NOW_MS, "good")]] * 4
        assert handler.peak == 1
        assert len(handler.requests) == 4
    finally:
        await driver.disconnect()


async def test_sources_share_a_bounded_global_request_budget() -> None:
    handler = GatedHandler()
    limiter = TrackingLimiter(2)
    drivers = [
        driver_for(handler, HttpSetup(limiter=limiter)) for _ in range(6)
    ]
    for driver in drivers:
        await driver.connect()
    tasks = [
        asyncio.create_task(driver.read_many(["value"])) for driver in drivers
    ]
    try:
        await handler.entered.get()
        await handler.entered.get()
        assert handler.active == 2
        handler.released.set()
        results = await asyncio.gather(*tasks)
        assert results == [[(21.5, NOW_MS, "good")]] * 6
        assert limiter.peak == 2
        assert limiter.active == 0
        assert handler.peak == 2
    finally:
        for driver in drivers:
            await driver.disconnect()


async def test_queued_read_is_stopped_before_network_after_revocation() -> None:
    handler = GatedHandler()
    limiter = TrackingLimiter()
    await limiter.acquire()
    limiter.queued.clear()
    driver = driver_for(handler, HttpSetup(limiter=limiter))
    await driver.connect()
    task = asyncio.create_task(driver.read_many(["value"]))
    try:
        await limiter.queued.wait()
        driver.revoke()
        limiter.release()
        with pytest.raises(DriverNotConnected):
            await task
        assert handler.requests == []
        assert limiter.active == 0
        with pytest.raises(DriverNotConnected):
            await driver.connect()
    finally:
        await driver.disconnect()


async def test_waiting_for_a_global_slot_has_the_request_total_timeout() -> (
    None
):
    handler = GatedHandler()
    limiter = TrackingLimiter()
    await limiter.acquire()
    driver = driver_for(
        handler, HttpSetup(options={"timeout_s": "0.01"}, limiter=limiter)
    )
    await driver.connect()
    try:
        assert await driver.read_many(["value"]) == [(None, NOW_MS, "bad")]
        assert handler.requests == []
        assert limiter.active == 1
        with pytest.raises(HttpRequestFailed):
            await driver.healthcheck()
    finally:
        limiter.release()
        await driver.disconnect()


async def test_single_flight_queue_cannot_multiply_the_timeout_budget() -> None:
    handler = GatedHandler()
    driver = driver_for(handler, HttpSetup(options={"timeout_s": "0.02"}))
    await driver.connect()
    tasks = [
        asyncio.create_task(driver.read_many(["value"])) for _ in range(16)
    ]
    try:
        results = await asyncio.wait_for(asyncio.gather(*tasks), timeout=0.2)
        assert results == [[(None, NOW_MS, "bad")]] * 16
        assert handler.active == 0
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await driver.disconnect()


async def test_cancellation_does_not_release_an_unowned_slot() -> None:
    handler = GatedHandler()
    limiter = TrackingLimiter()
    await limiter.acquire()
    limiter.queued.clear()
    driver = driver_for(handler, HttpSetup(limiter=limiter))
    await driver.connect()
    task = asyncio.create_task(driver.read_many(["value"]))
    try:
        await limiter.queued.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert limiter.active == 1
        assert handler.requests == []
    finally:
        limiter.release()
        await driver.disconnect()


async def test_revoke_cancels_an_active_request_and_releases_its_slot() -> None:
    handler = GatedHandler()
    limiter = TrackingLimiter()
    driver = driver_for(handler, HttpSetup(limiter=limiter))
    await driver.connect()
    task = asyncio.create_task(driver.read_many(["value"]))
    try:
        await handler.entered.get()
        driver.revoke()
        with pytest.raises(DriverNotConnected):
            await task
        assert handler.cancelled.is_set() is True
        assert limiter.active == 0
        assert len(handler.requests) == 1
    finally:
        await driver.disconnect()


async def test_revoke_cancels_oauth_before_the_data_request() -> None:
    handler = GatedHandler()
    driver = driver_for(
        handler,
        HttpSetup(
            options={
                "auth_type": "oauth2_client_credentials",
                "token_endpoint": TOKEN_ENDPOINT,
            },
            username=USER,
            password=SECRET,
        ),
    )
    await driver.connect()
    task = asyncio.create_task(driver.read_many(["value"]))
    try:
        request = await handler.entered.get()
        assert request.url.path == "/token"
        driver.revoke()
        with pytest.raises(DriverNotConnected):
            await task
        assert [request.url.path for request in handler.requests] == ["/token"]
    finally:
        await driver.disconnect()
