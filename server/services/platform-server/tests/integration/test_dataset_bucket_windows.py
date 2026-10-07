"""DST 身份网格经过真实归档、采集水位、回填与公式重算后的结果。"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import AppContext

from integration.backfill_helpers import Backfiller
from integration.collector_helpers import rows_of, set_watermark, watermark_of
from integration.dataset_helpers import (
    ArchiveWriter,
    Sample,
    create_column,
    create_table,
)
from lib.db import run_after_commit_hooks
from platform_server.apps.collect.services import ReadOnlyHistorySource
from platform_server.apps.dataset.crud import table_crud
from platform_server.apps.dataset.services.backfill_plan import (
    PlanLimits,
    plan_backfill,
)
from platform_server.apps.dataset.services.backfill_run import run_backfill
from platform_server.apps.dataset.services.backfill_service import initial_state
from platform_server.apps.dataset.services.buckets import (
    bucket_start,
    collected_row_id,
)
from platform_server.apps.dataset.services.collect_run import (
    RunContext,
    RunLimits,
    RunOutcome,
    collect_table,
)
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog

ZONE = "America/New_York"
GAP = datetime(2026, 3, 8, 7, tzinfo=UTC)
pytestmark = pytest.mark.requires_postgres


async def a_table(
    context: AppContext,
    archive: ArchiveWriter,
    width: timedelta,
    is_enabled: bool = True,
) -> dict[str, Any]:
    """建带点位列与公式列的独占台账。

    Args: context, archive, width, is_enabled。
    """
    table = await create_table(
        context.client,
        code="qa_dst_ind_" + uuid.uuid4().hex,
        collect_mode="aggregate",
        collect_interval_ms=int(width.total_seconds() * 1000),
        is_enabled=is_enabled,
    )
    await create_column(
        context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key("qa_dst"),
        agg="avg",
    )
    await create_column(
        context.client,
        table["id"],
        key="翻倍",
        name="翻倍",
        source="formula",
        formula="{均温} * 2",
    )
    return table


async def tick(
    context: AppContext,
    collaborators: tuple[ArchiveWriter, DatasetDirtyLog],
    table_id: str,
    now: datetime,
    tail: int = 0,
) -> RunOutcome | None:
    """采一拍并触发提交后的报脏。

    Args: context, collaborators, table_id, now, tail。
    """
    archive, dirty = collaborators
    outcome = await collect_table(
        context.session,
        RunContext(ReadOnlyHistorySource(archive.database), dirty, ZONE),
        table_id=uuid.UUID(table_id),
        now=now,
        limits=RunLimits(tail, 1500),
    )
    await context.session.commit()
    await run_after_commit_hooks(context.session)
    return outcome


async def test_spring_hour_collection_ignores_still_open_real_samples(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    table = await a_table(app_context, archive, timedelta(hours=1))
    await archive.write(
        "qa_dst",
        [
            Sample(GAP - timedelta(minutes=30), 10.0),
            Sample(GAP + timedelta(minutes=1), 999.0),
        ],
    )
    outcome = await tick(
        app_context, (archive, dirty), table["id"], GAP + timedelta(minutes=5)
    )
    assert outcome is not None
    assert outcome.written == 1
    rows = await rows_of(app_context.client, table["id"])
    assert len(rows) == 1
    assert datetime.fromisoformat(
        rows[0]["ts"].replace("Z", "+00:00")
    ) == GAP - timedelta(hours=1)
    assert rows[0]["values"]["均温"] == 10.0
    assert rows[0]["computed"]["翻倍"] == 20.0
    assert await watermark_of(app_context, table["id"]) == GAP - timedelta(
        hours=1
    )


@pytest.mark.parametrize(
    "width",
    [timedelta(seconds=11), timedelta(minutes=13)],
    ids=["11s", "13min"],
)
async def test_collector_keeps_future_label_gap_sample_without_duplicate_rows(
    app_context: AppContext,
    archive: ArchiveWriter,
    dirty: DatasetDirtyLog,
    width: timedelta,
) -> None:
    table = await a_table(app_context, archive, width)
    expected = bucket_start(GAP, interval=width, timezone=ZONE)
    await archive.write("qa_dst", [Sample(GAP, 21.0)])
    await set_watermark(
        app_context,
        table["id"],
        bucket_start(
            GAP - timedelta(minutes=20), interval=width, timezone=ZONE
        ),
    )
    await tick(
        app_context,
        (archive, dirty),
        table["id"],
        GAP + timedelta(hours=1, minutes=10),
    )
    rows = await rows_of(app_context.client, table["id"])
    assert len(rows) == 1
    assert (
        datetime.fromisoformat(rows[0]["ts"].replace("Z", "+00:00")) == expected
    )
    assert rows[0]["values"]["均温"] == 21.0
    assert rows[0]["samples"]["均温"] == 1
    assert rows[0]["computed"]["翻倍"] == 42.0
    assert uuid.UUID(rows[0]["row_id"]) == collected_row_id(
        uuid.UUID(table["id"]), expected
    )
    first_row_id = rows[0]["row_id"]
    await tick(
        app_context,
        (archive, dirty),
        table["id"],
        GAP + timedelta(hours=1, minutes=10),
        tail=100,
    )
    repeated = await rows_of(app_context.client, table["id"])
    assert len(repeated) == 1
    assert repeated[0]["row_id"] == first_row_id
    assert repeated[0]["values"]["均温"] == 21.0


@pytest.mark.parametrize(
    "width",
    [timedelta(seconds=11), timedelta(minutes=13)],
    ids=["11s", "13min"],
)
async def test_backfill_gap_samples_batches_and_formula_recompute_are_complete(
    app_context: AppContext, archive: ArchiveWriter, width: timedelta
) -> None:
    body = await a_table(app_context, archive, width, False)
    await archive.write(
        "qa_dst", [Sample(GAP, 10.0), Sample(GAP + timedelta(minutes=8), 25.0)]
    )
    table = await table_crud.get(app_context.session, uuid.UUID(body["id"]))
    assert table is not None
    since = GAP - timedelta(minutes=20)
    until = GAP + timedelta(hours=1)
    now = GAP + timedelta(hours=3)
    plan = plan_backfill(
        table,
        since=since,
        until=until,
        now=now,
        limits=PlanLimits(ZONE, None, 2),
    )
    state = initial_state(table, plan, (since, until), now)
    context = Backfiller(app_context, archive).job_context()
    assert await context.jobs.claim(table.id, context.token)
    await run_backfill(context, plan, state)
    assert state.status == "done"
    assert state.done_buckets == state.total_buckets
    assert state.written_rows == 2
    assert state.recompute_failed == 0
    rows = await rows_of(app_context.client, body["id"])
    assert len(rows) == 2
    expected = {
        bucket_start(GAP, interval=width, timezone=ZONE): 10.0,
        bucket_start(
            GAP + timedelta(minutes=8), interval=width, timezone=ZONE
        ): 25.0,
    }
    for row in rows:
        ts = datetime.fromisoformat(row["ts"].replace("Z", "+00:00"))
        assert row["values"]["均温"] == expected[ts]
        assert row["computed"]["翻倍"] == 2 * expected[ts]
        assert row["samples"]["均温"] == 1
    assert await watermark_of(app_context, body["id"]) is None
    ids = {row["row_id"] for row in rows}
    again = initial_state(table, plan, (since, until), now)
    assert await context.jobs.claim(table.id, context.token)
    await run_backfill(context, plan, again)
    repeated = await rows_of(app_context.client, body["id"])
    assert again.status == "done"
    assert len(repeated) == 2
    assert {row["row_id"] for row in repeated} == ids
