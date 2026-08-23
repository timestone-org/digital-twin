"""一趟清理的分批、预算与两道空值闸。

⚠ 这一组守的是三件「没人会报错」的事：`retention_days` 为空必须当**永久保留**
（当成 0 天就是一次不可逆的清库）；每一批各自提交且 `ts` 两端都有界（攒成一个
大事务会在压缩块上撞出解压额度）；回收索引拿不到排他锁必须**跳过**而不是把写入
堵死。
"""

import contextlib
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import retention_run
from platform_server.apps.dataset.services.retention_run import (
    BATCH_WINDOW,
    MAX_REINDEX_CHUNKS,
    Budget,
    RetentionJob,
    RetentionStats,
    SweepResult,
    keep_before,
    load_jobs,
    reindex_span,
    sweep_table,
)

NOW = datetime(2026, 8, 24, 3, 0, tzinfo=UTC)
TABLE = uuid.UUID("0192f0c0-0000-7000-8000-0000000000b1")
OTHER = uuid.UUID("0192f0c0-0000-7000-8000-0000000000b2")


@dataclass
class FakeSession:
    """只认 commit / rollback 的会话替身；真正的 SQL 由假 crud 顶掉。"""

    commits: int = 0
    rollbacks: int = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


@dataclass
class SpySessions:
    """记下开过几次会话。

    ⚠ 计数就是断言本身：永久保留的表必须**一次都不开**——开了就说明我们已经
    走到了发 DELETE 的那一步。
    """

    opened_one: FakeSession = field(default_factory=FakeSession)
    opened: int = 0

    @contextlib.asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        self.opened += 1
        yield cast(AsyncSession, self.opened_one)


@dataclass
class FakeCrud:
    """`crud/retention.py` 的替身：记下每一条 DELETE 的窗口。"""

    oldest: datetime | None = None
    per_window: int = 3
    chunks: list[str] = field(default_factory=list[str])
    locked: set[str] = field(default_factory=set[str])
    windows: list[tuple[uuid.UUID, datetime, datetime]] = field(
        default_factory=list[tuple[uuid.UUID, datetime, datetime]]
    )
    reindexed: list[str] = field(default_factory=list[str])

    async def oldest_ts(
        self, _session: object, table_id: uuid.UUID
    ) -> datetime | None:
        del table_id
        return self.oldest

    async def delete_window(
        self,
        _session: object,
        *,
        table_id: uuid.UUID,
        from_ts: datetime,
        to_ts: datetime,
    ) -> int:
        self.windows.append((table_id, from_ts, to_ts))
        return self.per_window

    async def chunks_in_span(
        self, _session: object, *, since: datetime, until: datetime
    ) -> list[str]:
        del since, until
        return list(self.chunks)

    async def reindex_chunk(self, _session: object, name: str) -> None:
        if name in self.locked:
            raise TimeoutError("拿不到排他锁")
        self.reindexed.append(name)


@pytest.fixture
def crud(monkeypatch: pytest.MonkeyPatch) -> FakeCrud:
    """把数据访问整层换掉，本组用例不碰真库。

    Args: monkeypatch。
    """
    fake = FakeCrud()
    for name in (
        "oldest_ts",
        "delete_window",
        "chunks_in_span",
        "reindex_chunk",
    ):
        monkeypatch.setattr(
            retention_run.retention_crud, name, getattr(fake, name)
        )
    return fake


def job(days: int | None, table_id: uuid.UUID = TABLE) -> RetentionJob:
    """一件清理活。

    Args: days, table_id。
    """
    return RetentionJob(table_id=table_id, code="ledger", retention_days=days)


@pytest.mark.parametrize("days", [None, 0, -1])
def test_a_table_without_a_positive_retention_is_kept_forever(
    days: int | None,
) -> None:
    """⚠ 第二道空值闸：空的语义是永久保留，当成 0 天就是一次不可逆的清库。

    Args: days。
    """
    assert keep_before(job(days), NOW) is None


def test_the_retention_boundary_is_that_many_days_before_now() -> None:
    assert keep_before(job(30), NOW) == NOW - timedelta(days=30)


async def test_a_table_kept_forever_never_even_opens_a_session(
    crud: FakeCrud,
) -> None:
    # ⚠ 第二道闸紧贴 DELETE：连查最老一行那一步都不许走到
    sessions = SpySessions()
    result = await sweep_table(
        cast(retention_run.Sessions, sessions),
        job(None),
        now=NOW,
        budget=Budget(100),
    )
    assert result == retention_run.NOTHING
    assert sessions.opened == 0
    assert crud.windows == []


async def test_a_table_whose_oldest_row_is_within_retention_deletes_nothing(
    crud: FakeCrud,
) -> None:
    crud.oldest = NOW - timedelta(days=3)
    result = await sweep_table(
        cast(retention_run.Sessions, SpySessions()),
        job(30),
        now=NOW,
        budget=Budget(100),
    )
    assert result.rows == 0
    assert crud.windows == []


async def test_an_empty_table_deletes_nothing(crud: FakeCrud) -> None:
    crud.oldest = None
    result = await sweep_table(
        cast(retention_run.Sessions, SpySessions()),
        job(30),
        now=NOW,
        budget=Budget(100),
    )
    assert result.rows == 0
    assert crud.windows == []


async def test_the_delete_is_sliced_into_chunk_wide_windows(
    crud: FakeCrud,
) -> None:
    """⚠ 一批一个 chunk 宽：攒成一个大事务会撞上压缩块的解压额度。"""
    cutoff = NOW - timedelta(days=30)
    crud.oldest = cutoff - BATCH_WINDOW * 2 - timedelta(days=1)
    await sweep_table(
        cast(retention_run.Sessions, SpySessions()),
        job(30),
        now=NOW,
        budget=Budget(1_000),
    )
    starts = [start for _table, start, _stop in crud.windows]
    stops = [stop for _table, _start, stop in crud.windows]
    assert starts[0] == crud.oldest
    # 窗口首尾相接、不重不漏，最后一格恰好停在保留边界上
    assert starts[1:] == stops[:-1]
    assert stops[-1] == cutoff
    assert all(stop - start <= BATCH_WINDOW for _t, start, stop in crud.windows)


async def test_every_batch_commits_on_its_own(crud: FakeCrud) -> None:
    # ⚠ 攒成一个大事务，某一批撞上解压额度就会把前面删掉的一起回滚
    sessions = SpySessions()
    crud.oldest = NOW - timedelta(days=30) - BATCH_WINDOW * 2
    await sweep_table(
        cast(retention_run.Sessions, sessions),
        job(30),
        now=NOW,
        budget=Budget(1_000),
    )
    assert sessions.opened_one.commits == len(crud.windows)


async def test_the_budget_stops_the_sweep_at_a_batch_boundary(
    crud: FakeCrud,
) -> None:
    """⚠ PG 的 DELETE 不能中途叫停，能保证的只有「超了不再发下一条」。"""
    crud.oldest = NOW - timedelta(days=30) - BATCH_WINDOW * 10
    crud.per_window = 4
    budget = Budget(5)
    result = await sweep_table(
        cast(retention_run.Sessions, SpySessions()),
        job(30),
        now=NOW,
        budget=budget,
    )
    # 第 1 批 4 行还没超，第 2 批之后到 8 行才收工——超出上限是必然的，
    # 而「超了还接着发」才是被禁的那件事
    assert len(crud.windows) == 2
    assert result.rows == 8
    assert budget.is_exhausted is True


async def test_the_sweep_reports_the_span_it_actually_touched(
    crud: FakeCrud,
) -> None:
    cutoff = NOW - timedelta(days=30)
    crud.oldest = cutoff - BATCH_WINDOW
    result = await sweep_table(
        cast(retention_run.Sessions, SpySessions()),
        job(30),
        now=NOW,
        budget=Budget(100),
    )
    assert result.span == (crud.oldest, cutoff)


async def test_a_sweep_that_deleted_nothing_reports_no_span(
    crud: FakeCrud,
) -> None:
    # 没删掉行就没有需要回收索引的 chunk
    crud.oldest = NOW - timedelta(days=40)
    crud.per_window = 0
    result = await sweep_table(
        cast(retention_run.Sessions, SpySessions()),
        job(30),
        now=NOW,
        budget=Budget(100),
    )
    assert result.rows == 0
    assert result.span is None


def test_the_budget_never_goes_below_one_row() -> None:
    # 上限 0 会让这一趟一条 DELETE 都发不出去，而界面上看不出任何区别
    assert Budget(0).max_rows == 1
    assert Budget(-5).max_rows == 1


def test_the_budget_ignores_a_negative_row_count() -> None:
    budget = Budget(10)
    budget.add(-3)
    assert budget.used == 0


def test_the_stats_take_the_widest_span_across_tables() -> None:
    stats = RetentionStats()
    early = datetime(2026, 1, 1, tzinfo=UTC)
    late = datetime(2026, 6, 1, tzinfo=UTC)
    stats.absorb(job(30), SweepResult(rows=1, span=(late, late)))
    stats.absorb(job(30, OTHER), SweepResult(rows=2, span=(early, early)))
    assert stats.span() == (early, late)
    assert stats.rows == 3


def test_the_stats_only_list_the_tables_that_actually_lost_rows() -> None:
    # 报脏跟着这份名单走：没掉行的表没有任何理由让大屏重新取数
    stats = RetentionStats()
    stats.absorb(job(30), SweepResult(rows=0, span=None))
    assert stats.swept == []
    assert stats.span() is None


async def test_a_chunk_whose_name_looks_wrong_is_never_reindexed(
    crud: FakeCrud,
) -> None:
    """⚠ chunk 名要拼进 DDL，形状不对一律跳过而不是照拼。"""
    crud.chunks = ["_timescaledb_internal._hyper_1_1", "bad; DROP TABLE x"]
    done = await reindex_span(
        cast(retention_run.Sessions, SpySessions()),
        span=(NOW - timedelta(days=40), NOW),
    )
    assert done == 1
    assert crud.reindexed == ["_timescaledb_internal._hyper_1_1"]


async def test_a_chunk_that_cannot_be_locked_is_skipped_not_raised(
    crud: FakeCrud,
) -> None:
    """⚠ 等锁超时必须吞掉：为了回收索引把写入堵死是拿要紧的事换不要紧的事。"""
    sessions = SpySessions()
    crud.chunks = ["chunk_a", "chunk_b"]
    crud.locked = {"chunk_a"}
    done = await reindex_span(
        cast(retention_run.Sessions, sessions),
        span=(NOW - timedelta(days=40), NOW),
    )
    assert done == 1
    assert crud.reindexed == ["chunk_b"]
    # ⚠ 失败要回滚：不回滚的话后面每个 chunk 都跟着报「事务已中止」
    assert sessions.opened_one.rollbacks == 1


async def test_reindexing_is_capped_so_the_exclusive_lock_stays_bounded(
    crud: FakeCrud,
) -> None:
    crud.chunks = [f"chunk_{index}" for index in range(MAX_REINDEX_CHUNKS + 5)]
    done = await reindex_span(
        cast(retention_run.Sessions, SpySessions()),
        span=(NOW - timedelta(days=40), NOW),
    )
    assert done == MAX_REINDEX_CHUNKS


async def test_a_broken_reindex_stage_never_fails_the_sweep(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """清理本身已经成功了，不该因为「索引没回收成」判故障。

    Args: monkeypatch。
    """

    async def explode(*_args: object, **_kwargs: object) -> list[str]:
        raise RuntimeError("元数据查询挂了")

    monkeypatch.setattr(retention_run.retention_crud, "chunks_in_span", explode)
    done = await reindex_span(
        cast(retention_run.Sessions, SpySessions()),
        span=(NOW - timedelta(days=40), NOW),
    )
    assert done == 0


async def test_loading_jobs_keeps_whatever_the_database_answered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 清单原样带上来，收窄留给紧贴 DELETE 的那道闸。

    第一道闸在 SQL 的 WHERE 上，第二道在 `keep_before` 里。这里若提前把空值
    收成 0，两道闸就变成了同一道。
    Args: monkeypatch。
    """

    async def with_retention(
        _session: object,
    ) -> list[tuple[uuid.UUID, str, int | None]]:
        return [(TABLE, "kept", 30), (OTHER, "forever", None)]

    monkeypatch.setattr(
        retention_run.table_crud, "with_retention", with_retention
    )
    jobs = await load_jobs(cast(retention_run.Sessions, SpySessions()))
    assert [item.retention_days for item in jobs] == [30, None]
    assert keep_before(jobs[1], NOW) is None
