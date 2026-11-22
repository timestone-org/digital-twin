"""用独立事务验证修改库公式与保存引用列的顺序。"""

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from integration.test_dataset_table_reference_lock import blocks
from lib.db import Database
from platform_server.apps.dataset.errors import (
    DatasetFormulaInUse,
    DatasetFormulaInvalid,
)
from platform_server.apps.dataset.models import DatasetFormula, DatasetTable
from platform_server.apps.dataset.schemas import (
    ColumnCreateIn,
    FormulaCreateIn,
    FormulaUpdateIn,
    TableCreateIn,
)
from platform_server.apps.dataset.services import (
    column_service,
    library_service,
    table_service,
)
from platform_server.settings import Settings

pytestmark = pytest.mark.requires_postgres


@dataclass(frozen=True)
class FormulaCase:
    database: Database
    formula_id: UUID
    table_id: UUID
    expression: str


@pytest.fixture
async def formula_case(
    settings: Settings, db_session: AsyncSession
) -> AsyncIterator[FormulaCase]:
    del db_session
    db = Database(dsn=settings.dsn(), search_path="platform")
    code = "qa_fx_" + uuid4().hex
    async with db.session() as session:
        fx = await library_service.create_formula(
            session,
            payload=FormulaCreateIn(code=code, name="锁顺序", expression="1"),
        )
        table = await table_service.create_table(
            session,
            payload=TableCreateIn(code="qa_" + uuid4().hex, name="合成台账"),
        )
    try:
        yield FormulaCase(db, fx.id, table.id, f"@{code}()")
    finally:
        async with db.session() as session:
            await session.execute(
                delete(DatasetTable).where(DatasetTable.id == table.id)
            )
            await session.execute(
                delete(DatasetFormula).where(DatasetFormula.id == fx.id)
            )
        await db.dispose()


async def perform(
    session: AsyncSession, case: FormulaCase, *, is_editor: bool
) -> None:
    if is_editor:
        await library_service.update_formula(
            session,
            formula_id=case.formula_id,
            payload=FormulaUpdateIn.model_validate(
                {"params": [{"name": "value"}], "expression": "{value}"}
            ),
        )
    else:
        await column_service.create_column(
            session,
            table_id=case.table_id,
            payload=ColumnCreateIn(
                key="result",
                name="结果",
                source="formula",
                formula=case.expression,
            ),
        )


async def follow(
    case: FormulaCase, pid: asyncio.Future[int], *, is_editor: bool
) -> str:
    try:
        async with case.database.session() as session:
            backend = await session.execute(text("SELECT pg_backend_pid()"))
            pid.set_result(int(backend.scalar_one()))
            await perform(session, case, is_editor=is_editor)
    except DatasetFormulaInUse:
        return "in_use"
    except DatasetFormulaInvalid:
        return "invalid"
    return "saved"


@pytest.mark.parametrize(
    ("is_editing_first", "expected"), [(False, "in_use"), (True, "invalid")]
)
async def test_definition_change_and_new_column_verify_the_committed_winner(
    formula_case: FormulaCase, is_editing_first: bool, expected: str
) -> None:
    pid: asyncio.Future[int] = asyncio.get_running_loop().create_future()
    async with (
        asyncio.TaskGroup() as group,
        formula_case.database.session() as holder,
    ):
        await perform(holder, formula_case, is_editor=is_editing_first)
        later = group.create_task(
            follow(formula_case, pid, is_editor=not is_editing_first)
        )
        was_blocked = await blocks(holder, later, await pid)
    assert was_blocked
    assert later.result() == expected
