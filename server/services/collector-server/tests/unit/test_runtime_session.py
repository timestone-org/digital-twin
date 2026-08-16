"""守一条会话的一生：订阅还是轮询、状态上报、失败分类与退避、点位增删。

⚠ 「不支持订阅就降级轮询」与「只改点位不重连」两条如果坏了，表现分别是
「一个不产值的会话」与「每次保存配置断采一次」，都不会报错。
"""

import asyncio
from typing import Any

import pytest

from collector_server.apps.collect.drivers.base import (
    DriverCapabilities,
    RejectedPoint,
)
from collector_server.apps.collect.runtime.session import (
    BASE_BACKOFF_S,
    SessionOptions,
    SourceSession,
    backoff_delay_s,
    jitter,
)
from collectwire import READ_MODE_POLL, STATE_OFFLINE

OPTIONS = SessionOptions(heartbeat_interval_s=0.01, max_backoff_s=30.0)
NO_ABILITIES = DriverCapabilities(
    is_subscribe_supported=False,
    is_browse_supported=False,
    is_write_supported=False,
)


async def _until(is_done: Any, *, timeout_s: float = 3.0) -> None:
    """等一个条件成立；等不到就让用例失败而不是挂住。

    ⚠ 不用固定 sleep：慢机器上那是必然的偶发失败。

    Args: is_done, timeout_s。
    """
    async with asyncio.timeout(timeout_s):
        # 抑制的理由 —— 等的是同一个事件循环上别的任务推进，不是外部信号；
        # 换成 Event 就要求被测对象为测试多出一个通知点
        while not is_done():  # noqa: ASYNC110
            await asyncio.sleep(0)


def _session(source: Any, driver: Any, reporter: Any) -> SourceSession:
    return SourceSession(
        source=source,
        driver=driver,
        sink=lambda *_: None,
        options=OPTIONS,
        reporter=reporter,
    )


def test_jitter_stays_inside_the_unit_interval() -> None:
    assert all(0.0 <= jitter() < 1.0 for _ in range(50))


@pytest.mark.parametrize(
    ("attempt", "ratio", "expected"),
    [
        (1, 0.0, 1.0),
        (1, 1.0, 2.0),
        (3, 0.0, 4.0),
        (30, 0.0, 15.0),
    ],
    ids=["first-no-jitter", "first-full-jitter", "third", "capped"],
)
def test_backoff_grows_then_caps(
    attempt: int, ratio: float, expected: float
) -> None:
    assert backoff_delay_s(attempt, max_s=30.0, ratio=ratio) == expected


def test_backoff_base_is_one_second() -> None:
    assert BASE_BACKOFF_S == 1.0


async def test_opening_reports_connecting_then_online(
    driver: Any, reporter: Any, build_source: Any
) -> None:
    session = _session(build_source(), driver, reporter)
    await session._open()
    assert reporter.states() == ["connecting", "online"]
    assert driver.subscribed == ["outlet_temp"]


async def test_driver_without_subscription_falls_back_to_polling(
    reporter: Any, build_driver: Any, build_source: Any
) -> None:
    driver = build_driver(capabilities=NO_ABILITIES)
    session = _session(build_source(), driver, reporter)
    await session._open()
    # 等轮询真的问出第一轮，而不是靠 sleep 猜它已经跑过
    await asyncio.wait_for(driver.has_polled.wait(), timeout=2)
    await session.stop()
    assert driver.subscribed == []
    assert driver.reads[0] == ("outlet_temp",)


async def test_poll_read_mode_polls_even_when_subscription_is_available(
    driver: Any, reporter: Any, build_source: Any
) -> None:
    session = _session(build_source(read_mode=READ_MODE_POLL), driver, reporter)
    await session._open()
    await asyncio.sleep(0)
    await session.stop()
    assert driver.subscribed == []


async def test_rejected_points_do_not_stop_the_accepted_ones(
    driver: Any, reporter: Any, build_source: Any, build_point: Any
) -> None:
    driver.rejected = (RejectedPoint("broken", "BadNodeIdUnknown"),)
    session = _session(
        build_source(points=(build_point("a"), build_point("broken"))),
        driver,
        reporter,
    )
    await session._open()
    assert session.is_online is True


async def test_adding_a_point_does_not_reconnect(
    driver: Any, reporter: Any, build_source: Any, build_point: Any
) -> None:
    session = _session(build_source(), driver, reporter)
    await session._open()
    await session.apply(
        build_source(points=(build_point("outlet_temp"), build_point("flow")))
    )
    assert driver.is_connected is True
    assert driver.subscribed == ["outlet_temp", "flow"]


async def test_removing_a_point_unsubscribes_only_that_one(
    driver: Any, reporter: Any, build_source: Any, build_point: Any
) -> None:
    session = _session(
        build_source(points=(build_point("a"), build_point("b"))),
        driver,
        reporter,
    )
    await session._open()
    await session.apply(build_source(points=(build_point("a"),)))
    assert driver.unsubscribed == ["b"]


async def test_transient_failure_is_reported_offline_and_backs_off(
    driver: Any, reporter: Any, build_source: Any
) -> None:
    session = _session(build_source(), driver, reporter)
    delay_s = await session._on_failure(TimeoutError(), 1)
    assert reporter.reported[-1].state == STATE_OFFLINE
    assert reporter.reported[-1].error_category == "transient"
    assert 0 < delay_s <= 2.0


async def test_configuration_errors_wait_the_full_backoff(
    driver: Any, reporter: Any, build_source: Any
) -> None:
    driver.classify_error = lambda _error: "config"
    session = _session(build_source(), driver, reporter)
    delay_s = await session._on_failure(ValueError("寻址串写错了"), 1)
    assert delay_s == OPTIONS.max_backoff_s


async def test_stopping_closes_the_connection(
    driver: Any, reporter: Any, build_source: Any
) -> None:
    session = _session(build_source(), driver, reporter)
    await session._open()
    await session.stop()
    assert driver.is_connected is False
    assert session.is_online is False


async def test_run_keeps_retrying_after_a_refused_connection(
    reporter: Any, build_driver: Any, build_source: Any
) -> None:
    driver = build_driver(connect_error=ConnectionRefusedError())
    session = _session(build_source(), driver, reporter)
    task = asyncio.create_task(session.run())
    await asyncio.wait_for(reporter.has_reported.wait(), timeout=2)
    await session.stop()
    async with asyncio.timeout(3):
        await task
    assert STATE_OFFLINE in reporter.states()


async def test_a_dropped_heartbeat_tears_the_session_down(
    reporter: Any, build_driver: Any, build_source: Any
) -> None:
    driver = build_driver(heartbeat_error=ConnectionResetError())
    session = _session(build_source(), driver, reporter)
    task = asyncio.create_task(session.run())
    await _until(lambda: STATE_OFFLINE in reporter.states())
    await session.stop()
    async with asyncio.timeout(3):
        await task
    assert driver.is_connected is False
