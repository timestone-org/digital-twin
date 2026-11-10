"""重算任务的两条收尾路径：锁丢了就中止、关停就取消——两者都一行不写。

⚠ 算的那一步换成一个永远等着的协程：这里只钉调度与收尾，算得对不对由
`tests/integration/test_dataset_recompute_job.py` 对着真库验。
"""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from lib.testing import InMemoryCache
from platform_server.apps.dataset.services import RecomputeRunner, recompute_run
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from platform_server.apps.dataset.services.recompute_run import (
    STATUS_RUNNING,
    RecomputeJobState,
)
from unit.dataset_fakes import FakeSetSink, recompute_jobs

TABLE_ID = uuid.UUID("01a1aed2-dd19-7216-9ee2-a0102a829d28")
NOW = datetime(2026, 11, 10, 5, 0, tzinfo=UTC)


class NoSessions:
    """会话工厂的占位：算的那一步已被换掉，谁开会话谁就是写错了。"""

    def session(self) -> Any:
        raise AssertionError("这条用例不该开会话")


def a_runner(store: InMemoryCache) -> RecomputeRunner:
    """一个协作者全是进程内假件的起跑口。

    Args: store。
    """
    return RecomputeRunner(
        sessions=NoSessions(),
        dirty=DatasetDirtyLog(sink=FakeSetSink()),
        jobs=recompute_jobs(store),
        timezone=ZoneInfo("Asia/Shanghai"),
        instance="unit",
    )


def a_state() -> RecomputeJobState:
    """一份刚起的任务态。"""
    return RecomputeJobState(
        table_id=str(TABLE_ID),
        table_code="t",
        status=STATUS_RUNNING,
        since=None,
        until=None,
        started_at=NOW,
        updated_at=NOW,
    )


@pytest.fixture
def hanging_compute(monkeypatch: pytest.MonkeyPatch) -> asyncio.Event:
    """把「算」换成一直等下去；回一个被取消时置位的事件。"""
    cancelled = asyncio.Event()

    async def hang(*_args: object) -> object:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise
        raise AssertionError("unreachable")

    monkeypatch.setattr(recompute_run, "_recompute_once", hang)
    return cancelled


async def test_losing_the_lock_aborts_the_job_and_cancels_the_work(
    hanging_compute: asyncio.Event, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(recompute_run, "RENEW_EVERY_S", 0)
    store = InMemoryCache()
    runner = a_runner(store)
    # 锁在别人手上：本任务第一次续锁就续不上
    assert await runner.jobs.claim(TABLE_ID, "someone-else")
    state = a_state()

    await recompute_run.run_recompute(runner.context("mine"), state)

    assert hanging_compute.is_set()
    assert state.status == "failed"
    assert state.error == "重算中止：这张台账的锁已经不在本次任务手上"
    # 别人的锁不许被顺手放掉
    assert not await runner.jobs.claim(TABLE_ID, "third")


async def test_shutdown_cancels_a_running_job_and_records_why(
    hanging_compute: asyncio.Event,
) -> None:
    store = InMemoryCache()
    runner = a_runner(store)
    assert await runner.jobs.claim(TABLE_ID, "mine")
    state = a_state()
    runner.launch(state, token="mine")
    await asyncio.sleep(0)

    await runner.drain(timeout_s=0.01)

    assert hanging_compute.is_set()
    found = await runner.jobs.read(TABLE_ID)
    assert found is not None
    assert (found["status"], found["error"]) == ("failed", "进程关停")
    assert found["finished_at"] is not None
    # 收摊放锁：下一次重算立刻能起
    assert await runner.jobs.claim(TABLE_ID, "next")
    assert runner.tasks == {}


async def test_drain_with_nothing_running_returns_at_once() -> None:
    runner = a_runner(InMemoryCache())

    await asyncio.wait_for(runner.drain(timeout_s=60), timeout=1)

    assert runner.tasks == {}
