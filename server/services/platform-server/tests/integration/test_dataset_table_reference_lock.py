"""台账删除与跨表公式保存通过两个独立 PostgreSQL 事务交错执行。"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal

import pytest
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from platform_server.apps.dataset.errors import (
    DatasetFormulaInvalid,
    DatasetTableInUse,
)
from platform_server.apps.dataset.models import DatasetTable
from platform_server.apps.dataset.schemas import (
    ColumnCreateIn,
    ColumnUpdateIn,
    TableCreateIn,
)
from platform_server.apps.dataset.services import column_service, table_service
from platform_server.settings import Settings

pytestmark = pytest.mark.requires_postgres
Action = Literal["delete", "create", "edit"]


@dataclass(frozen=True)
class Tables:
    database: Database
    source: uuid.UUID
    consumer: uuid.UUID
    column: uuid.UUID
    expression: str


@pytest.fixture
async def tables(
    settings: Settings, db_session: AsyncSession
) -> AsyncIterator[Tables]:
    del db_session
    db = Database(dsn=settings.dsn(), search_path="platform")
    async with db.session() as session:
        source = await table_service.create_table(
            session,
            payload=TableCreateIn(code="s_" + uuid.uuid4().hex, name="来源"),
        )
        owner = await table_service.create_table(
            session,
            payload=TableCreateIn(code="c_" + uuid.uuid4().hex, name="汇总"),
        )
        await column_service.create_column(
            session,
            table_id=source.id,
            payload=ColumnCreateIn(key="v", name="原值"),
        )
        column = await column_service.create_column(
            session,
            table_id=owner.id,
            payload=ColumnCreateIn(key="v", name="原值"),
        )
    try:
        yield Tables(
            db, source.id, owner.id, column.id, f"MAX_ALL({{{source.code}.v}})"
        )
    finally:
        async with db.session() as session:
            await session.execute(
                delete(DatasetTable).where(
                    DatasetTable.id.in_([source.id, owner.id])
                )
            )
        await db.dispose()


async def act(session: AsyncSession, case: Tables, action: Action) -> None:
    if action == "delete":
        await table_service.delete_table(session, table_id=case.source)
    elif action == "create":
        await column_service.create_column(
            session,
            table_id=case.consumer,
            payload=ColumnCreateIn(
                key="new",
                name="合计",
                source="formula",
                formula=case.expression,
            ),
        )
    else:
        await column_service.update_column(
            session,
            table_id=case.consumer,
            column_id=case.column,
            payload=ColumnUpdateIn(source="formula", formula=case.expression),
        )


async def compete(
    case: Tables, action: Action, pid: asyncio.Future[int]
) -> str:
    try:
        async with case.database.session() as session:
            result = await session.execute(text("SELECT pg_backend_pid()"))
            pid.set_result(int(result.scalar_one()))
            await act(session, case, action)
    except DatasetTableInUse:
        return "table_in_use"
    except DatasetFormulaInvalid:
        return "table_missing"
    return "success"


async def blocks(
    holder: AsyncSession, pending: asyncio.Task[str], pid: int
) -> bool:
    query = text("SELECT pg_backend_pid() = ANY(pg_blocking_pids(:pid))")
    async with asyncio.timeout(10):
        while not pending.done():
            if await holder.scalar(query, {"pid": pid}):
                return True
            await asyncio.sleep(0.01)
    return False


@pytest.mark.parametrize(
    ("first", "second", "result"),
    [
        ("create", "delete", "table_in_use"),
        ("edit", "delete", "table_in_use"),
        ("delete", "create", "table_missing"),
        ("delete", "edit", "table_missing"),
    ],
)
async def test_a_formula_write_serializes_with_deleting_its_source(
    tables: Tables, first: Action, second: Action, result: str
) -> None:
    pid: asyncio.Future[int] = asyncio.get_running_loop().create_future()
    async with (
        asyncio.TaskGroup() as group,
        tables.database.session() as holder,
    ):
        await act(holder, tables, first)
        later = group.create_task(compete(tables, second, pid))
        was_blocked = await blocks(holder, later, await pid)

    assert was_blocked
    assert later.result() == result
