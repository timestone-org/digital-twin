"""共享计算池的执行中取消与排队取消隔离。"""

import asyncio
from collections.abc import Callable
from concurrent.futures import Executor, Future
from typing import Any

import pytest

from platform_server.apps.modeling.services.node_task import (
    NodePayload,
    NodeResult,
)
from platform_server.apps.modeling.services.run_pool import (
    NodePool,
    PooledRunner,
)


class PendingExecutor(Executor):
    """在 Executor 边界上显式完成 Future 的假件。"""

    def __init__(self) -> None:
        self.entered = asyncio.Event()
        self.pending: list[Future[Any]] = []
        self.closed = False

    def submit[Result](
        self, _fn: Callable[..., Result], /, *_args: Any, **_kwargs: Any
    ) -> Future[Result]:
        future: Future[Result] = Future()
        self.pending.append(future)
        self.entered.set()
        return future

    def shutdown(
        self, wait: bool = True, *, cancel_futures: bool = False
    ) -> None:
        del wait
        self.closed = True
        if cancel_futures:
            for future in self.pending:
                future.cancel()


def payload() -> NodePayload:
    return NodePayload(
        operator="source",
        config={},
        inputs={},
        tz_offset_minutes=0,
        split_plan=None,
    )


async def test_cancelling_running_job_recycles_pool() -> None:
    executor = PendingExecutor()
    pool = NodePool(factory=lambda: executor)
    task = asyncio.create_task(PooledRunner(pool, timeout_s=5).run(payload()))
    try:
        await asyncio.wait_for(executor.entered.wait(), timeout=5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert executor.closed
    finally:
        pool.shutdown()


async def test_cancelling_waiter_preserves_running_job() -> None:
    executor = PendingExecutor()
    pool = NodePool(factory=lambda: executor)
    runner = PooledRunner(pool, timeout_s=5)
    running = asyncio.create_task(runner.run(payload()))
    waiting_started = asyncio.Event()

    async def wait_for_slot() -> NodeResult:
        waiting_started.set()
        return await runner.run(payload())

    try:
        await asyncio.wait_for(executor.entered.wait(), timeout=5)
        waiting = asyncio.create_task(wait_for_slot())
        await waiting_started.wait()
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        assert not executor.closed
        assert len(executor.pending) == 1
        executor.pending[0].set_result(NodeResult(outputs={"ok": True}))
        assert (await running).outputs == {"ok": True}
    finally:
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)
        pool.shutdown()


async def test_waiting_timeout_does_not_recycle_active_job() -> None:
    executor = PendingExecutor()
    pool = NodePool(factory=lambda: executor)
    running = asyncio.create_task(
        PooledRunner(pool, timeout_s=5).run(payload())
    )
    try:
        await asyncio.wait_for(executor.entered.wait(), timeout=5)
        with pytest.raises(TimeoutError):
            await PooledRunner(pool, timeout_s=0.01).run(payload())
        assert not executor.closed
        assert len(executor.pending) == 1
        executor.pending[0].set_result(NodeResult(outputs={"ok": True}))
        assert (await running).outputs == {"ok": True}
    finally:
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)
        pool.shutdown()


async def test_failure_recycles_pool_and_next_job_can_finish() -> None:
    executors: list[PendingExecutor] = []

    def factory() -> PendingExecutor:
        executor = PendingExecutor()
        executors.append(executor)
        return executor

    pool = NodePool(factory=factory)
    runner = PooledRunner(pool, timeout_s=5)
    try:
        task = asyncio.create_task(runner.run(payload()))
        await asyncio.wait_for(executors[0].entered.wait(), timeout=5)
        executors[0].pending[0].set_exception(RuntimeError("计算池损坏"))
        with pytest.raises(RuntimeError, match="计算池损坏"):
            await task
        assert executors[0].closed
        next_task = asyncio.create_task(runner.run(payload()))
        await asyncio.wait_for(executors[1].entered.wait(), timeout=5)
        executors[1].pending[0].set_result(NodeResult(outputs={"ok": True}))
        assert (await next_task).outputs == {"ok": True}
    finally:
        pool.shutdown()
