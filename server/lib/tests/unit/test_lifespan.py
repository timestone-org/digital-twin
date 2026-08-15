"""锁住启停编排：关停顺序由显式声明决定，**不是**启动顺序的逆序；
单个组件停不下来不阻断其余组件让位与 flush。
"""

import asyncio
import contextlib
import signal
from unittest import mock

import pytest

from lib.lifespan import (
    LifespanHook,
    LifespanRunner,
    ReadinessGate,
    wait_for_termination,
)


def recorder() -> tuple[list[str], object]:
    log: list[str] = []

    def make(name: str):
        async def action() -> None:
            log.append(name)

        return action

    return log, make


async def test_startup_follows_declared_order() -> None:
    log, make = recorder()
    runner = LifespanRunner(
        hooks=(
            LifespanHook("b", startup=make("b"), startup_order=20),
            LifespanHook("a", startup=make("a"), startup_order=10),
        )
    )
    await runner.startup()
    assert log == ["a", "b"]


async def test_shutdown_order_is_not_the_reverse_of_startup() -> None:
    log, make = recorder()
    # 归档器启动最早但必须最后停：它要接住其它组件 teardown 时补交的尾批
    runner = LifespanRunner(
        hooks=(
            LifespanHook(
                "archiver",
                startup=make("start:archiver"),
                shutdown=make("stop:archiver"),
                startup_order=10,
                shutdown_order=99,
            ),
            LifespanHook(
                "api",
                startup=make("start:api"),
                shutdown=make("stop:api"),
                startup_order=20,
                shutdown_order=10,
            ),
        )
    )
    await runner.startup()
    log.clear()
    await runner.shutdown()
    assert log == ["stop:api", "stop:archiver"]


async def test_readiness_opens_after_startup_and_closes_on_shutdown() -> None:
    runner = LifespanRunner(hooks=())
    assert not runner.gate.is_ready
    await runner.startup()
    assert runner.gate.is_ready
    await runner.shutdown()
    assert not runner.gate.is_ready
    assert runner.gate.reason == "shutting_down"


async def test_a_failing_component_does_not_block_the_others() -> None:
    log, make = recorder()

    async def explode() -> None:
        raise RuntimeError("stuck")

    runner = LifespanRunner(
        hooks=(
            LifespanHook("bad", shutdown=explode, shutdown_order=10),
            LifespanHook("good", shutdown=make("good"), shutdown_order=20),
        )
    )
    await runner.shutdown()
    assert log == ["good"]


async def test_a_hanging_component_is_bounded_by_the_drain_timeout() -> None:
    log, make = recorder()

    async def hang() -> None:
        await asyncio.sleep(5)

    runner = LifespanRunner(
        hooks=(
            LifespanHook("hang", shutdown=hang, shutdown_order=10),
            LifespanHook("good", shutdown=make("good"), shutdown_order=20),
        ),
        drain_timeout_s=0.05,
    )
    await runner.shutdown()
    assert log == ["good"]


async def test_startup_failure_propagates_and_leaves_gate_closed() -> None:
    async def explode() -> None:
        raise RuntimeError("cannot start")

    runner = LifespanRunner(hooks=(LifespanHook("bad", startup=explode),))
    with pytest.raises(RuntimeError):
        await runner.startup()
    assert not runner.gate.is_ready


def test_gate_reports_the_reason_it_was_closed() -> None:
    gate = ReadinessGate()
    gate.open()
    gate.close("draining")
    assert (gate.is_ready, gate.reason) == (False, "draining")


async def test_termination_wait_survives_loops_without_signal_support() -> None:
    """⚠ Windows 的事件循环 `add_signal_handler` 直接抛 NotImplementedError。

    不接住的话 worker / publisher 这类不监听端口的角色一起来就崩在这一行，
    而走 uvicorn 的 api 角色毫发无伤，故容器里怎么跑都验不出来。
    """
    loop = asyncio.get_running_loop()
    installed: list[int] = []

    def refuse(number: int, handler: object) -> None:
        raise NotImplementedError

    def record(number: int, _handler: object) -> None:
        installed.append(number)

    with (
        mock.patch.object(loop, "add_signal_handler", refuse),
        mock.patch.object(signal, "signal", record),
    ):
        waiting = asyncio.ensure_future(wait_for_termination())
        await asyncio.sleep(0)
        assert installed == [signal.SIGTERM, signal.SIGINT]
        waiting.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await waiting


async def test_termination_wait_returns_once_the_signal_arrives() -> None:
    loop = asyncio.get_running_loop()
    handlers: dict[int, object] = {}

    def refuse(number: int, handler: object) -> None:
        raise NotImplementedError

    def record(number: int, handler: object) -> None:
        handlers[number] = handler

    with (
        mock.patch.object(loop, "add_signal_handler", refuse),
        mock.patch.object(signal, "signal", record),
    ):
        waiting = asyncio.ensure_future(wait_for_termination())
        await asyncio.sleep(0)
        handle = handlers[signal.SIGTERM]
        assert callable(handle)
        # 同步 handler 不在事件循环里跑，故它只能把置位排进循环
        handle(int(signal.SIGTERM), None)
        async with asyncio.timeout(1):
            await waiting
