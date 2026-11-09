"""回填的起跑口：强引用、收摊，与「跑挂了也要落一个终态」。

⚠ 事件循环只持有任务的弱引用：丢了引用的任务可能随时消失，现象是一次回填
「起了、但什么都没补」，而日志里连一条失败都没有。
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lib.testing import InMemoryCache
from platform_server.apps.dataset.models import DatasetTable
from platform_server.apps.dataset.services import backfill_run
from platform_server.apps.dataset.services.backfill_jobs import (
    STATUS_FAILED,
    BackfillJobs,
    BackfillJobState,
)
from platform_server.apps.dataset.services.backfill_plan import (
    BackfillPlan,
    PlanLimits,
    plan_backfill,
)
from platform_server.apps.dataset.services.backfill_run import BackfillContext
from platform_server.apps.dataset.services.backfill_service import (
    BackfillRunner,
    initial_state,
)
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from platform_server.settings import Settings
from unit.dataset_fakes import FakeHistory, FakeSetSink

SHANGHAI = "Asia/Shanghai"
HOUR = timedelta(hours=1)
NOW = datetime(2026, 8, 24, 5, 30, tzinfo=UTC)
TABLE_ID = uuid.UUID("0192f0c0-0000-7000-8000-0000000000aa")


@dataclass(frozen=True)
class ExplodingSessions:
    """一开事务就炸的会话工厂。

    ⚠ 用它验的是「任务本体炸了之后还有没有人收摊」：真库那一侧由
    `integration/test_dataset_backfill.py` 验，这里只要一个必然失败的入口。
    """

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        """开不出来。"""
        raise RuntimeError("库连不上")
        yield  # pragma: no cover —— 上一行必然抛，这里只为让它成为生成器


def a_table() -> DatasetTable:
    """一张按小时聚合的台账。"""
    table = DatasetTable()
    table.id = TABLE_ID
    table.code = "shift_output"
    table.collect_mode = "aggregate"
    table.collect_interval_ms = 3_600_000
    table.is_enabled = True
    table.last_collected_ts = None
    return table


def a_runner(settings: Settings) -> BackfillRunner:
    """一个真的起跑口，会话工厂必然炸。

    Args: settings。
    """
    return BackfillRunner(
        sessions=ExplodingSessions(),
        history=FakeHistory(),
        dirty=DatasetDirtyLog(sink=FakeSetSink()),
        jobs=BackfillJobs(store=InMemoryCache()),
        settings=settings,
    )


def a_launch(runner: BackfillRunner) -> None:
    """起一个必然失败的回填。

    Args: runner。
    """
    table = a_table()
    plan = plan_backfill(
        table,
        since=NOW - 6 * HOUR,
        until=NOW - 5 * HOUR,
        now=NOW,
        limits=PlanLimits(
            timezone=SHANGHAI, retention_days=None, recompute_tail_buckets=2
        ),
    )
    state = initial_state(table, plan, (NOW - 6 * HOUR, NOW - 5 * HOUR), NOW)
    runner.launch(plan, state, token="token", batch_timeout_s=5.0)


async def test_a_launched_job_is_held_by_a_strong_reference(
    settings: Settings,
) -> None:
    runner = a_runner(settings)

    a_launch(runner)

    assert TABLE_ID in runner.tasks
    await runner.drain(timeout_s=5)


async def test_a_job_that_blows_up_still_lands_a_terminal_state(
    settings: Settings,
) -> None:
    # ⚠ 后台任务不许把异常漏给事件循环：漏了的话任务态永远停在「在跑」，
    # 而那张表的下一次回填要等锁自己过期
    runner = a_runner(settings)

    a_launch(runner)
    await runner.drain(timeout_s=5)

    found = await runner.jobs.read(TABLE_ID)
    assert found is not None
    assert found["status"] == STATUS_FAILED
    assert found["finished_at"] is not None


async def test_a_finished_job_lets_go_of_its_reference(
    settings: Settings,
) -> None:
    # ⚠ 不摘的话，一个长跑进程会把每一张回填过的表的任务对象一直攥在手里
    runner = a_runner(settings)
    a_launch(runner)

    await runner.drain(timeout_s=5)
    # 完成回调是 `call_soon` 排的，让出一次事件循环它才跑
    await asyncio.sleep(0)

    assert runner.tasks == {}


async def test_a_finished_job_releases_the_lock_it_held(
    settings: Settings,
) -> None:
    runner = a_runner(settings)
    await runner.jobs.claim(TABLE_ID, "token")
    a_launch(runner)

    await runner.drain(timeout_s=5)

    assert await runner.jobs.claim(TABLE_ID, "next") is True


async def test_stopping_the_runner_raises_the_shutdown_flag(
    settings: Settings,
) -> None:
    runner = a_runner(settings)

    runner.stop()

    assert runner.stopped.is_set()


async def test_draining_waits_until_the_running_job_is_done(
    settings: Settings,
) -> None:
    """⚠ 关停链条靠它：不等就等于「摘完流量直接关连接池」，手上那一批的提交
    会撞在一个已经关掉的池上，而任务态永远停在「在跑」。
    """
    runner = a_runner(settings)
    a_launch(runner)
    task = runner.tasks[TABLE_ID]

    await runner.drain(timeout_s=5)

    assert task.done() is True


async def test_draining_with_nothing_running_returns_at_once(
    settings: Settings,
) -> None:
    """⚠ 手上一个都没有时不许去 `asyncio.wait` 一个空集合：那是 ValueError，
    而它会在关停链条上炸出来——恰好是最不该有意外的那一刻。
    ⚠ 也不许傻等满预算：外层那个 1 秒的闸就是用来钉住「立刻返回」的，
    一个「等到超时为止」的实现会在这里红。
    """
    runner = a_runner(settings)

    async with asyncio.timeout(1):
        await runner.drain(timeout_s=30)

    assert runner.tasks == {}


class QuietSessions:
    """开得出、但不连库的会话工厂，供收尾重算的用例用。"""

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        """一个未绑定的会话。"""
        async with AsyncSession() as session:
            yield session


class LostLockJobs(BackfillJobs):
    """续锁永远失败的任务存储。"""

    async def renew(self, table_id: uuid.UUID, token: str) -> bool:
        """锁已经不在手上。Args: table_id, token。"""
        del table_id, token
        return False


def a_tail_case(
    jobs: BackfillJobs,
) -> tuple[BackfillContext, BackfillPlan, BackfillJobState]:
    """一次已经写过行、正要收尾重算的回填。

    Args: jobs。
    """
    table = a_table()
    plan = plan_backfill(
        table,
        since=NOW - 6 * HOUR,
        until=NOW - 5 * HOUR,
        now=NOW,
        limits=PlanLimits(
            timezone=SHANGHAI, retention_days=None, recompute_tail_buckets=2
        ),
    )
    state = initial_state(table, plan, (NOW - 6 * HOUR, NOW - 5 * HOUR), NOW)
    state.written_rows = 3
    context = BackfillContext(
        sessions=QuietSessions(),
        history=FakeHistory(),
        dirty=DatasetDirtyLog(sink=FakeSetSink()),
        jobs=jobs,
        token="token",
        batch_timeout_s=5.0,
        stopped=asyncio.Event(),
    )
    return context, plan, state


async def test_a_lost_lock_before_the_tail_recompute_skips_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # ⚠ 锁丢了还接着重算，就是两个任务同时改写同一段
    recompute = AsyncMock()
    monkeypatch.setattr(backfill_run, "recompute_range", recompute)
    context, plan, state = a_tail_case(LostLockJobs(store=InMemoryCache()))

    await backfill_run._recompute_tail(context, plan, state, [])

    recompute.assert_not_awaited()
    assert state.status == STATUS_FAILED


async def test_a_failed_job_does_not_run_the_tail_recompute(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recompute = AsyncMock()
    monkeypatch.setattr(backfill_run, "recompute_range", recompute)
    context, plan, state = a_tail_case(BackfillJobs(store=InMemoryCache()))
    state.fail("单飞锁已失去", "回填中止")

    await backfill_run._recompute_tail(context, plan, state, [])

    recompute.assert_not_awaited()


async def test_a_tail_recompute_over_budget_is_cut_and_said_out_loud(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def slow(*_arguments: object, **_options: object) -> None:
        await asyncio.sleep(5)

    monkeypatch.setattr(backfill_run, "RECOMPUTE_TIMEOUT_S", 0.01)
    monkeypatch.setattr(backfill_run, "recompute_range", slow)
    monkeypatch.setattr(
        backfill_run, "_compile", AsyncMock(return_value=object())
    )
    jobs = BackfillJobs(store=InMemoryCache())
    context, plan, state = a_tail_case(jobs)
    assert await jobs.claim(TABLE_ID, "token")

    await backfill_run._recompute_tail(context, plan, state, [])

    assert state.is_recompute_truncated is True
    assert any("重算没做完" in note for note in state.notes)
