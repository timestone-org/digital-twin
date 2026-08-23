"""回填任务态：三个键各管各的，读不出来要响亮抛。

⚠ 「我说不出来」与「什么都没有」是两个答案（docs/DATASET_DESIGN.md §14.6）：
混成一个的话，用户会在读不到的时候又发一次回填，而那一次撞上的是仍然握着锁的
上一次。
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from lib.testing import InMemoryCache, UnavailableCache
from platform_server.apps.dataset.errors import DatasetBackfillUnreadable
from platform_server.apps.dataset.services.backfill_jobs import (
    KEY_PREFIX,
    STATUS_RUNNING,
    BackfillJobs,
    BackfillJobState,
)

TABLE_ID = uuid.UUID("0192f0c0-0000-7000-8000-0000000000aa")
NOW = datetime(2026, 8, 24, 5, 30, tzinfo=UTC)


def a_state(**overrides: Any) -> BackfillJobState:
    """一个刚起跑的任务态。

    Args: overrides。
    """
    state = BackfillJobState(
        table_id=str(TABLE_ID),
        table_code="shift_output",
        status=STATUS_RUNNING,
        interval_ms=3_600_000,
        since=NOW,
        until=NOW,
        requested_since=NOW,
        requested_until=NOW,
        is_clamped=False,
        fast_path="raw",
        total_buckets=3,
        started_at=NOW,
        updated_at=NOW,
    )
    for key, value in overrides.items():
        setattr(state, key, value)
    return state


async def test_a_written_state_reads_back_with_utc_strings() -> None:
    cache = InMemoryCache()
    jobs = BackfillJobs(store=cache)

    await jobs.write(a_state(), at=NOW)

    found = await jobs.read(TABLE_ID)
    assert found is not None
    assert found["table_code"] == "shift_output"
    assert found["since"] == "2026-08-24T05:30:00.000Z"
    assert cache.ttl_s[f"{KEY_PREFIX}{TABLE_ID}"] == jobs.state_ttl_s


async def test_no_job_reads_back_as_none() -> None:
    assert await BackfillJobs(store=InMemoryCache()).read(TABLE_ID) is None


async def test_a_corrupt_state_is_reported_not_swallowed() -> None:
    cache = InMemoryCache()
    cache.store[f"{KEY_PREFIX}{TABLE_ID}"] = "{不是 JSON"

    with pytest.raises(DatasetBackfillUnreadable):
        await BackfillJobs(store=cache).read(TABLE_ID)


async def test_a_state_that_is_not_an_object_is_reported_too() -> None:
    cache = InMemoryCache()
    cache.store[f"{KEY_PREFIX}{TABLE_ID}"] = "[1, 2, 3]"

    with pytest.raises(DatasetBackfillUnreadable):
        await BackfillJobs(store=cache).read(TABLE_ID)


async def test_a_second_claim_on_the_same_table_is_refused() -> None:
    # ⚠ 单飞靠 `SET NX` 这一次原子写：先查再插会让两个同时打进来的请求双双
    # 看见「没人占」，于是两个回填一起改写同一段历史
    jobs = BackfillJobs(store=InMemoryCache())

    assert await jobs.claim(TABLE_ID, "first") is True
    assert await jobs.claim(TABLE_ID, "second") is False


async def test_only_the_owner_can_renew_the_lock() -> None:
    jobs = BackfillJobs(store=InMemoryCache())
    await jobs.claim(TABLE_ID, "first")

    assert await jobs.renew(TABLE_ID, "first") is True
    assert await jobs.renew(TABLE_ID, "second") is False


async def test_releasing_frees_the_lock_but_keeps_the_state() -> None:
    # ⚠ 任务态不能当锁：跑完还要留着给人看，拿它当锁就是把下一次回填永久
    # 挡在门外
    cache = InMemoryCache()
    jobs = BackfillJobs(store=cache)
    await jobs.write(a_state(), at=NOW)
    await jobs.claim(TABLE_ID, "first")
    await jobs.request_cancel(TABLE_ID)

    await jobs.release(TABLE_ID, "first")

    assert await jobs.read(TABLE_ID) is not None
    assert await jobs.claim(TABLE_ID, "second") is True
    assert await jobs.is_cancelled(TABLE_ID) is False


async def test_releasing_never_takes_away_a_lock_that_moved_on() -> None:
    # ⚠ 自己那把锁可能早已过期并被下一个回填抢走（收尾重算跑得比 TTL 还久就
    # 会这样）：无条件删就是把接任者的锁一起删掉，而它正以为自己独占着
    jobs = BackfillJobs(store=InMemoryCache())
    await jobs.claim(TABLE_ID, "next-owner")
    await jobs.request_cancel(TABLE_ID)

    await jobs.release(TABLE_ID, "the-one-that-timed-out")

    assert await jobs.claim(TABLE_ID, "third") is False
    # 取消标志也留着：那是按给接任者的，不是按给已经收摊的这一个
    assert await jobs.is_cancelled(TABLE_ID) is True


async def test_a_cancel_flag_is_visible_to_another_reader() -> None:
    # 受理取消的副本与跑任务的副本可以是两个进程，故标志必须在 Redis 上
    cache = InMemoryCache()
    await BackfillJobs(store=cache).request_cancel(TABLE_ID)

    assert await BackfillJobs(store=cache).is_cancelled(TABLE_ID) is True


async def test_an_unreadable_cancel_flag_does_not_stop_the_run() -> None:
    # ⚠ 宁可多补一批幂等的行，也不要因为 Redis 抖一下就把一次跑到一半的回填
    # 停在半路
    assert (
        await BackfillJobs(store=UnavailableCache()).is_cancelled(TABLE_ID)
        is False
    )


async def test_a_quiet_write_reports_the_outage_instead_of_dropping_it(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """进度心跳写不进去只该少一次刷新，不该把一次已经落库的回填变成失败。

    ⚠ 三件都要断言：**没有异常漏出去**（回填照跑）、任务态在内存里照常推进、
    以及**日志里留下了一条**。少了最后一条，「静默吞掉」与「安静地正常」在
    运维那里长得一模一样。
    """
    state = a_state()
    later = NOW + timedelta(minutes=1)

    with caplog.at_level(logging.WARNING):
        await BackfillJobs(store=UnavailableCache()).write(
            state, at=later, is_quiet=True
        )

    assert state.updated_at == later
    events = [record.getMessage() for record in caplog.records]
    assert "dataset_backfill_state_write_failed" in events


async def test_a_loud_write_lets_the_outage_through() -> None:
    with pytest.raises(Exception, match="缓存"):
        await BackfillJobs(store=UnavailableCache()).write(a_state(), at=NOW)


def test_failing_a_state_keeps_the_progress_it_had() -> None:
    # ⚠ 失败不抹掉已经补进去的战果：那些行是真的写进去了，回执说「一行没补」
    # 会让人去重跑一段本已完整的区间
    state = a_state(done_buckets=2, written_rows=7)

    state.fail("超时", "回填失败：这一批超出了预算")

    assert state.status == "failed"
    assert (state.done_buckets, state.written_rows) == (2, 7)
    assert state.error == "超时"
