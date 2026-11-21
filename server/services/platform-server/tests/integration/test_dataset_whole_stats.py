"""整列统计对 PostgreSQL 内的行和当前编辑行采用相同取值口径。"""

import sys
import unicodedata
from collections.abc import Sequence
from datetime import timedelta
from uuid import UUID

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.dataset_helpers import create_table
from lib.utils.ids import uuid7
from lib.utils.timeutils import utcnow
from platform_server.apps.dataset.crud import record_crud
from platform_server.apps.dataset.models import DatasetRecord

pytestmark = pytest.mark.requires_postgres


async def _records(
    session: AsyncSession, table_id: UUID, cells: Sequence[object]
) -> None:
    now = utcnow()
    for offset, cell in enumerate(cells):
        session.add(
            DatasetRecord(
                table_id=table_id,
                ts=now + timedelta(seconds=offset),
                row_id=uuid7(),
                values_json={"v": cell},
                source="manual",
            )
        )
    await session.flush()


@pytest.mark.parametrize(
    ("cells", "expected"),
    [
        ([True, False, "7", "停机", None, " \t", 0], (5, 4, 8.0)),
        (
            [
                "１２.５",
                " +.5 ",
                "1_2",
                "1.e2",
                "1e-5000",
                "1e5000",
                "NaN",
                "\u00a0",
            ],
            (7, 5, 125.0),
        ),
        (["٧.٥", "٧.٥", "停机", True], (4, 3, 16.0)),
        (["  ", "\u3000", "\u0085", None], (0, 0, None)),
    ],
)
async def test_whole_stats_counts_present_and_numeric_cells(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    cells: list[object],
    expected: tuple[int, int, float | None],
) -> None:
    table = await create_table(app_client)
    table_id = UUID(str(table["id"]))
    await _records(db_session, table_id, cells)
    stats = (
        await record_crud.whole_stats(db_session, table_id=table_id, keys=["v"])
    )["v"]
    present, numeric, total = expected
    assert stats.total == total
    assert stats.count == numeric
    assert stats.present_count == present


async def test_stats_respect_explicit_nulls_and_exclude_the_old_row(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    table = await create_table(app_client)
    table_id = UUID(str(table["id"]))
    now = utcnow()
    previous = uuid7()
    for offset, (key, computed, overrides) in enumerate(
        [
            (previous, {}, {}),
            (uuid7(), {"v": None}, {"v": {"v": 3}}),
            (uuid7(), {}, {"v": {"v": False}}),
            (uuid7(), {}, {"v": {"v": None}}),
            (uuid7(), {"v": "停机"}, {"v": {"v": 4}}),
        ]
    ):
        db_session.add(
            DatasetRecord(
                table_id=table_id,
                ts=now + timedelta(seconds=offset),
                row_id=key,
                values_json={"v": 10},
                overrides_json=overrides,
                computed_json=computed,
                source="manual",
            )
        )
    await db_session.flush()
    stats = (
        await record_crud.whole_stats(
            db_session,
            table_id=table_id,
            keys=["v", "v"],
            exclude_row_id=previous,
        )
    )["v"]
    assert (stats.minimum, stats.maximum, stats.total) == (0, 10, 10)
    assert (stats.count, stats.present_count) == (2, 3)


async def test_large_finite_samples_do_not_abort_the_whole_query(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    table = await create_table(app_client)
    table_id = UUID(str(table["id"]))
    await _records(db_session, table_id, [1.7e308, 1.7e308])
    stats = (
        await record_crud.whole_stats(db_session, table_id=table_id, keys=["v"])
    )["v"]
    assert stats.count == 2
    assert stats.average() is None
    assert stats.maximum == 1.7e308


async def test_database_and_python_agree_on_unicode_digits_and_whitespace(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    table = await create_table(app_client)
    table_id = UUID(str(table["id"]))
    digits = []
    blanks = []
    for codepoint in range(sys.maxunicode + 1):
        character = chr(codepoint)
        if unicodedata.decimal(character, None) == 2:
            digits.append(character)
        if character.isspace():
            blanks.append(character)
    await _records(db_session, table_id, [*digits, *blanks, "²"])
    stats = (
        await record_crud.whole_stats(db_session, table_id=table_id, keys=["v"])
    )["v"]
    assert stats.count == len(digits)
    assert stats.present_count == len(digits) + 1
    assert stats.total == 2 * len(digits)
    assert stats.average() == 2
