"""同一台账的写入与删除由 PostgreSQL 事务决定顺序。"""

import asyncio
import uuid
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

import pytest
from conftest import AppContext
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession
from unit.dataset_fakes import FakeSetSink

from integration.backfill_helpers import Backfiller, bucket_ago, seed
from integration.collector_helpers import run_pass
from integration.dataset_helpers import TABLES, ArchiveWriter
from integration.test_dataset_backfill import a_point_table
from integration.test_dataset_table_reference_lock import blocks
from lib.db import Database
from platform_server.apps.dataset.crud import record_crud
from platform_server.apps.dataset.errors import (
    DatasetTableNotEmpty,
    DatasetTableNotFound,
)
from platform_server.apps.dataset.models import DatasetRecord, DatasetTable
from platform_server.apps.dataset.schemas import (
    ColumnCreateIn,
    RecordCreateIn,
    TableCreateIn,
)
from platform_server.apps.dataset.services import (
    aggregate,
    backfill_run,
    collect_run,
    column_service,
    record_write,
    table_service,
)
from platform_server.apps.dataset.services.aggregate import (
    BucketWindow,
    Cell,
    HistoryReader,
    PointColumn,
)
from platform_server.apps.dataset.services.backfill_jobs import STATUS_FAILED
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from platform_server.apps.dataset.services.record_values import Actor
from platform_server.settings import Settings

pytestmark = pytest.mark.requires_postgres
Action = Literal["insert", "delete", "force"]


@dataclass(frozen=True)
class Ledger:
    database: Database
    table_id: uuid.UUID


@pytest.fixture
async def ledger(
    settings: Settings, db_session: AsyncSession
) -> AsyncIterator[Ledger]:
    del db_session
    database = Database(dsn=settings.dsn(), search_path="platform")
    async with database.session() as session:
        table = await table_service.create_table(
            session,
            payload=TableCreateIn(
                code="qa_" + uuid.uuid4().hex, name="并发台账"
            ),
        )
        await column_service.create_column(
            session,
            table_id=table.id,
            payload=ColumnCreateIn(key="v", name="读数"),
        )
    try:
        yield Ledger(database, table.id)
    finally:
        async with database.session() as session:
            await session.execute(
                delete(DatasetRecord).where(DatasetRecord.table_id == table.id)
            )
            await session.execute(
                delete(DatasetTable).where(DatasetTable.id == table.id)
            )
        await database.dispose()


async def perform(
    session: AsyncSession, ledger: Ledger, action: Action
) -> None:
    if action == "insert":
        writer = record_write.RecordWriter(
            DatasetDirtyLog(FakeSetSink()),
            UTC,
            Actor(name="QA"),
            ledger.database,
        )
        await record_write.create_record(
            session,
            writer,
            table_id=ledger.table_id,
            payload=RecordCreateIn(values={"v": 7}),
        )
    else:
        await table_service.delete_table(
            session, table_id=ledger.table_id, is_forced=action == "force"
        )


async def follow(case: Ledger, action: Action, pid: asyncio.Future[int]) -> str:
    try:
        async with case.database.session() as session:
            result = await session.execute(text("SELECT pg_backend_pid()"))
            pid.set_result(int(result.scalar_one()))
            await perform(session, case, action)
    except DatasetTableNotEmpty:
        return "history"
    except DatasetTableNotFound:
        return "missing"
    return "stored"


@pytest.mark.parametrize(
    ("first", "next_action", "outcome", "remaining"),
    [
        ("insert", "delete", "history", 1),
        ("insert", "force", "stored", 0),
        ("delete", "insert", "missing", 0),
    ],
)
async def test_writing_a_row_serializes_with_deleting_its_table(
    ledger: Ledger,
    first: Action,
    next_action: Action,
    outcome: str,
    remaining: int,
) -> None:
    pid: asyncio.Future[int] = asyncio.get_running_loop().create_future()
    async with (
        asyncio.TaskGroup() as group,
        ledger.database.session() as holder,
    ):
        await perform(holder, ledger, first)
        pending = group.create_task(follow(ledger, next_action, pid))
        was_blocked = await blocks(holder, pending, await pid)
    assert was_blocked
    assert pending.result() == outcome
    async with ledger.database.session() as session:
        assert (
            await record_crud.count_by_table(session, ledger.table_id)
            == remaining
        )


@pytest.mark.parametrize(
    "is_backfill", [True, False], ids=["backfill", "collector"]
)
async def test_a_table_removed_while_history_is_loading_has_no_orphan_records(
    app_context: AppContext,
    archive: ArchiveWriter,
    monkeypatch: pytest.MonkeyPatch,
    is_backfill: bool,
) -> None:
    table_id = await a_point_table(app_context, archive)
    start = bucket_ago(6)
    await seed(archive, start, 7.0)

    async def remove_after_read(
        reader: HistoryReader,
        *,
        columns: Sequence[PointColumn],
        window: BucketWindow,
    ) -> dict[datetime, dict[str, Cell]]:
        result = await aggregate.aggregate_cells(
            reader, columns=columns, window=window
        )
        assert result
        response = await app_context.client.delete(f"{TABLES}/{table_id}")
        assert response.status_code == 204
        return result

    monkeypatch.setattr(
        backfill_run if is_backfill else collect_run,
        "aggregate_cells",
        remove_after_read,
    )
    if is_backfill:
        state = await Backfiller(app_context, archive).run_now(
            table_id, since=start, until=start + timedelta(hours=1)
        )
        assert state.status == STATUS_FAILED
        assert state.written_rows == 0
    else:
        result = await run_pass(
            app_context,
            (DatasetDirtyLog(app_context.dirty), archive),
            table_id=table_id,
            now=start + timedelta(hours=1, minutes=30),
        )
        assert result is None
    assert (
        await record_crud.count_by_table(
            app_context.session, uuid.UUID(table_id)
        )
        == 0
    )
