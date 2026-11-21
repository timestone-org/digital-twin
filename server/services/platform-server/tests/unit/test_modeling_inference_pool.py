"""独立推理进程在预算到期、取消或普通拒绝后保持可用。"""

import asyncio
import os
import time
from functools import partial

import pytest

from lib.errors import DependencyUnavailable
from platform_server.apps.modeling.errors import PredictRequestInvalid
from platform_server.apps.modeling.services import inference_pool
from platform_server.apps.modeling.services.inference_pool import InferencePool


def reject() -> PredictRequestInvalid:
    """返回一次正常的输入拒绝。"""
    return PredictRequestInvalid("合成输入无效")


async def test_rejected_rows_do_not_recycle_a_healthy_worker() -> None:
    pool = InferencePool()
    try:
        worker = await pool.calculate(os.getpid)
        assert worker != os.getpid()
        with pytest.raises(PredictRequestInvalid, match="合成输入"):
            await pool.calculate(reject)
        assert await pool.calculate(os.getpid) == worker
    finally:
        await pool.close()
    with pytest.raises(DependencyUnavailable, match="停止"):
        await pool.calculate(os.getpid)


async def test_a_timed_out_computation_releases_its_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = InferencePool()
    try:
        worker = await pool.calculate(os.getpid)
        with monkeypatch.context() as clock:
            clock.setattr(inference_pool, "INFERENCE_TIMEOUT_S", 0.05)
            with pytest.raises(DependencyUnavailable):
                await pool.calculate(partial(time.sleep, 5))
        assert await pool.calculate(os.getpid) != worker
    finally:
        await pool.close()


async def test_cancelling_a_waiter_keeps_the_running_worker() -> None:
    pool = InferencePool()
    try:
        worker = await pool.calculate(os.getpid)
        running = asyncio.create_task(pool.calculate(partial(time.sleep, 0.1)))
        await asyncio.sleep(0)
        waiter = asyncio.create_task(pool.calculate(os.getpid))
        await asyncio.sleep(0)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        await running
        assert await pool.calculate(os.getpid) == worker
    finally:
        await pool.close()
