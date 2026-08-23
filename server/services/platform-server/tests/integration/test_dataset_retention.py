"""保留期清理对着真库跑一趟：真的删、真的只删过期的、真的找得到 chunk。

⚠ 这一层必须打真库：压缩超表上的 DELETE、`show_chunks` 能不能解析、`REINDEX
TABLE` 能不能在事务里跑，三样都只有真跑一遍才作数——拿假件断言 SQL 文本的单元
用例对「函数解析不到」「谓词命中不了 chunk」这类失败**完全无感**。
分批、预算与两道空值闸那几条在 `tests/unit/test_dataset_retention_run.py`。
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import AppContext

from integration.dataset_helpers import create_table
from lib.utils.ids import uuid7
from platform_server.apps.dataset.crud import (
    CollectedRow,
    RecordWindow,
    record_crud,
    retention_crud,
    table_crud,
)
from platform_server.apps.dataset.services.collector import Sessions
from platform_server.apps.dataset.services.retention_run import (
    Budget,
    RetentionJob,
    keep_before,
    load_jobs,
    reindex_span,
    sweep_table,
)

pytestmark = pytest.mark.requires_postgres

# 时间轴写死：断言里的时刻因此全是可手写的常量
NOW = datetime(2026, 8, 24, 3, 0, tzinfo=UTC)
KEPT_DAYS = 30
# 一条早该删掉的、一条刚好还在保留期里的
EXPIRED_TS = NOW - timedelta(days=KEPT_DAYS + 5)
FRESH_TS = NOW - timedelta(days=KEPT_DAYS - 5)
# 取行窗口的两端，宽到把上面两个时刻都包进去
EPOCH = datetime(2000, 1, 1, tzinfo=UTC)
FOREVER = datetime(2100, 1, 1, tzinfo=UTC)


def sessions_of(context: AppContext) -> Sessions:
    """用例那条回滚事务上的「开短事务」面。

    ⚠ 必须与 HTTP 那侧共用同一条连接：分开连就是两个事务，用例种下的行在清理
    那边根本看不见，而现象是「一行都没删」，看着像谓词写错了。
    Args: context。
    """
    return context.backfill.sessions


async def seed_rows(
    context: AppContext, table_id: str, moments: list[datetime]
) -> None:
    """往一张台账里种几行，时刻由用例指定。

    Args: context, table_id, moments。
    """
    await record_crud.upsert_collected(
        context.session,
        table_id=uuid.UUID(table_id),
        rows=[
            CollectedRow(
                ts=moment, row_id=uuid7(), values={"读数": 1.0}, samples={}
            )
            for moment in moments
        ],
        manual_keys=[],
    )
    await context.session.commit()


async def remaining(context: AppContext, table_id: str) -> list[datetime]:
    """这张台账现在还剩哪几个时刻的行，升序。

    Args: context, table_id。
    """
    async with sessions_of(context).session() as session:
        rows = await record_crud.list_ascending(
            session,
            window=RecordWindow(
                table_id=uuid.UUID(table_id),
                since=EPOCH,
                until=FOREVER,
            ),
        )
    return sorted(row.ts for row in rows)


async def make_ledger(
    context: AppContext, *, code: str, retention_days: int | None
) -> dict[str, Any]:
    """建一张带（或不带）保留期的台账。编码带随机后缀，用例之间互不打架。

    Args: context, code, retention_days。
    """
    return await create_table(
        context.client,
        code=f"{code}_{uuid7().hex[:8]}",
        retention_days=retention_days,
    )


async def test_only_the_rows_past_the_retention_are_deleted(
    app_context: AppContext,
) -> None:
    table = await make_ledger(
        app_context, code="ret_basic", retention_days=KEPT_DAYS
    )
    await seed_rows(app_context, table["id"], [EXPIRED_TS, FRESH_TS])
    result = await sweep_table(
        sessions_of(app_context),
        RetentionJob(
            table_id=uuid.UUID(table["id"]),
            code=str(table["code"]),
            retention_days=KEPT_DAYS,
        ),
        now=NOW,
        budget=Budget(1_000),
    )
    assert result.rows == 1
    assert await remaining(app_context, table["id"]) == [FRESH_TS]


async def test_a_ledger_kept_forever_never_loses_a_row(
    app_context: AppContext,
) -> None:
    """⚠ `retention_days` 为空是永久保留，当成 0 天就是一次不可逆的清库。"""
    table = await make_ledger(
        app_context, code="ret_forever", retention_days=None
    )
    await seed_rows(app_context, table["id"], [EXPIRED_TS, FRESH_TS])
    job = RetentionJob(
        table_id=uuid.UUID(table["id"]),
        code=str(table["code"]),
        retention_days=None,
    )
    assert keep_before(job, NOW) is None
    result = await sweep_table(
        sessions_of(app_context), job, now=NOW, budget=Budget(1_000)
    )
    assert result.rows == 0
    assert await remaining(app_context, table["id"]) == [
        EXPIRED_TS,
        FRESH_TS,
    ]


async def test_the_job_list_skips_the_ledgers_kept_forever(
    app_context: AppContext,
) -> None:
    # ⚠ 第一道空值闸就在这条 WHERE 上；第二道在 `keep_before` 里
    kept = await make_ledger(
        app_context, code="ret_listed", retention_days=KEPT_DAYS
    )
    forever = await make_ledger(
        app_context, code="ret_unlisted", retention_days=None
    )
    await app_context.session.commit()
    jobs = await load_jobs(sessions_of(app_context))
    codes = {job.code for job in jobs}
    assert kept["code"] in codes
    assert forever["code"] not in codes
    assert all(
        job.retention_days is not None and job.retention_days > 0
        for job in jobs
    )


async def test_one_ledger_does_not_see_another_ledgers_rows(
    app_context: AppContext,
) -> None:
    # 谓词按 `table_id` 定位：漏掉它就是把隔壁台账一起删了，而两张表看起来都对
    mine = await make_ledger(
        app_context, code="ret_mine", retention_days=KEPT_DAYS
    )
    neighbour = await make_ledger(
        app_context, code="ret_neighbour", retention_days=KEPT_DAYS
    )
    await seed_rows(app_context, mine["id"], [EXPIRED_TS])
    await seed_rows(app_context, neighbour["id"], [EXPIRED_TS])
    await sweep_table(
        sessions_of(app_context),
        RetentionJob(
            table_id=uuid.UUID(mine["id"]),
            code=str(mine["code"]),
            retention_days=KEPT_DAYS,
        ),
        now=NOW,
        budget=Budget(1_000),
    )
    assert await remaining(app_context, mine["id"]) == []
    assert await remaining(app_context, neighbour["id"]) == [EXPIRED_TS]


async def test_the_oldest_row_lookup_answers_from_the_hypertable(
    app_context: AppContext,
) -> None:
    table = await make_ledger(
        app_context, code="ret_floor", retention_days=KEPT_DAYS
    )
    async with sessions_of(app_context).session() as session:
        assert (
            await retention_crud.oldest_ts(session, uuid.UUID(table["id"]))
            is None
        )
    await seed_rows(app_context, table["id"], [FRESH_TS, EXPIRED_TS])
    async with sessions_of(app_context).session() as session:
        found = await retention_crud.oldest_ts(session, uuid.UUID(table["id"]))
    assert found == EXPIRED_TS


async def test_the_chunk_listing_resolves_and_the_reindex_really_runs(
    app_context: AppContext,
) -> None:
    """⚠ 这条守的是两件只有真库才说得清的事。

    一是 `show_chunks` 写不写全限定：业务写连接的 search_path 只有 platform，
    不限定就报「function show_chunks(…) does not exist」；二是 `REINDEX TABLE`
    能不能在事务块里跑——不能的话整段回收索引在生产上一次都没成功过，而日志里
    只会是一条 WARNING。
    """
    table = await make_ledger(
        app_context, code="ret_chunks", retention_days=KEPT_DAYS
    )
    await seed_rows(app_context, table["id"], [EXPIRED_TS, FRESH_TS])
    async with sessions_of(app_context).session() as session:
        names = await retention_crud.chunks_in_span(
            session,
            since=EXPIRED_TS - timedelta(days=1),
            until=NOW,
        )
    assert names
    assert all(retention_crud.CHUNK_NAME.match(name) for name in names)
    done = await reindex_span(
        sessions_of(app_context),
        span=(EXPIRED_TS - timedelta(days=1), NOW),
    )
    assert done >= 1


async def test_the_retention_column_is_readable_back_from_the_table(
    app_context: AppContext,
) -> None:
    # 保留期是这条链路唯一的输入，写进去读不出来就整条链路失灵
    table = await make_ledger(app_context, code="ret_column", retention_days=7)
    await app_context.session.commit()
    async with sessions_of(app_context).session() as session:
        row = await table_crud.get(session, uuid.UUID(table["id"]))
    assert row is not None
    assert row.retention_days == 7
