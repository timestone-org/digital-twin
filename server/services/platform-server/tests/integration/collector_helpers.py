"""聚合采集器用例共用的时间轴与跑一拍的捷径。

时间轴写死：`NOW` 落在 05:00Z 那个**还开着**的桶里，故最后一个已关闭的桶恒为
`CLOSED`（04:00Z）。断言里的时刻因此全是可手写的常量。
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from conftest import AppContext

from integration.dataset_helpers import ArchiveWriter, create_table
from lib.db import run_after_commit_hooks
from platform_server.apps.collect.services import ReadOnlyHistorySource
from platform_server.apps.dataset.crud import table_crud
from platform_server.apps.dataset.services.collect_run import (
    RunContext,
    RunLimits,
    RunOutcome,
    collect_table,
)
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog

SHANGHAI = "Asia/Shanghai"
HOUR = timedelta(hours=1)
HOUR_MS = 3_600_000
# 一拍的「此刻」。当前桶是 05:00Z（还开着），最后一个已关闭的桶是 04:00Z
NOW = datetime(2026, 8, 24, 5, 30, tzinfo=UTC)
CLOSED = datetime(2026, 8, 24, 4, 0, tzinfo=UTC)
POINT = "meter_kwh"


async def aggregate_table(
    client: httpx.AsyncClient, **overrides: Any
) -> dict[str, Any]:
    """建一张按小时聚合的台账。

    Args: client, overrides。
    """
    return await create_table(
        client,
        collect_mode="aggregate",
        collect_interval_ms=HOUR_MS,
        **overrides,
    )


async def run_pass(
    context: AppContext,
    runner: tuple[DatasetDirtyLog, ArchiveWriter],
    *,
    table_id: str,
    now: datetime = NOW,
    tail: int = 0,
) -> RunOutcome | None:
    """跑一拍并提交，让提交后的报脏钩子照常发出去。

    Args: context, runner（报脏口与归档写入者）, table_id, now, tail。
    """
    dirty_log, writer = runner
    outcome = await collect_table(
        context.session,
        RunContext(
            history=ReadOnlyHistorySource(database=writer.database),
            dirty=dirty_log,
            timezone=SHANGHAI,
        ),
        table_id=uuid.UUID(table_id),
        now=now,
        limits=RunLimits(recompute_tail_buckets=tail, max_buckets_per_tick=240),
    )
    await context.session.commit()
    await run_after_commit_hooks(context.session)
    return outcome


async def rows_of(
    client: httpx.AsyncClient, table_id: str
) -> list[dict[str, Any]]:
    """一张台账当前的全部数据行，按时间升序。

    Args: client, table_id。
    """
    response = await client.get(
        f"/api/v1/platform/dataset-tables/{table_id}/records",
        params={"size": 50},
    )
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["data"]["items"]
    return sorted(items, key=lambda row: str(row["ts"]))


async def watermark_of(context: AppContext, table_id: str) -> datetime | None:
    """库里那张台账此刻的水位。

    Args: context, table_id。
    """
    table = await table_crud.get(context.session, uuid.UUID(table_id))
    assert table is not None
    await context.session.refresh(table)
    return table.last_collected_ts


async def set_watermark(
    context: AppContext, table_id: str, moment: datetime
) -> None:
    """把水位挪到某一刻，好让这一拍能覆盖多个桶。

    Args: context, table_id, moment。
    """
    table = await table_crud.get(context.session, uuid.UUID(table_id))
    assert table is not None
    table.last_collected_ts = moment
    await context.session.commit()
