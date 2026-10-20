"""双会话导入竞争由唯一约束保护，并将失败批次整体回滚。"""

import asyncio
import uuid
from collections.abc import AsyncIterator, Sequence

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from platform_server.apps.collect.crud import point_crud
from platform_server.apps.collect.errors import PointCodeTaken
from platform_server.apps.collect.models import CollectPoint, CollectSource
from platform_server.apps.collect.schemas import PointItemIn
from platform_server.apps.collect.schemas.point_import import PointImportIn
from platform_server.apps.collect.services.point_import import (
    _flush_import,
    _save_import,
)
from platform_server.settings import Settings

pytestmark = pytest.mark.requires_postgres
SOURCE_ID = uuid.UUID("27a477cf-f741-495a-83ae-a1d258ab477e")


@pytest.fixture
async def import_database(settings: Settings) -> AsyncIterator[Database]:
    database = Database(dsn=settings.dsn(), search_path="platform")
    async with database.session() as session:
        session.add(
            CollectSource(
                id=SOURCE_ID,
                code="point-import-concurrency",
                name="并发导入",
                protocol="opcua",
                endpoint="opc.tcp://127.0.0.1:4840",
                read_mode="subscribe",
                poll_interval_ms=1000,
                is_enabled=False,
            )
        )
    try:
        yield database
    finally:
        async with database.session() as session:
            await session.execute(
                delete(CollectSource).where(
                    CollectSource.id == SOURCE_ID,
                )
            )
        await database.dispose()


@pytest.fixture
def simultaneous_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    original = point_crud.lock_by_codes
    barrier = asyncio.Barrier(2)

    async def synchronized(
        session: AsyncSession, source_id: uuid.UUID, codes: Sequence[str]
    ) -> list[CollectPoint]:
        found = await original(session, source_id, codes)
        async with asyncio.timeout(5):
            await barrier.wait()
        return found

    monkeypatch.setattr(point_crud, "lock_by_codes", synchronized)


async def import_batch(database: Database, unique_code: str) -> object:
    payload = PointImportIn.model_validate(
        {
            "source_id": SOURCE_ID,
            "items": [
                {
                    "code": code,
                    "name": code,
                    "address": f"ns=2;s={code}",
                    "data_type": "float",
                }
                for code in ("common", unique_code)
            ],
        }
    )
    async with database.session() as session:
        return await _save_import(session, payload, [])


@pytest.mark.usefixtures("simultaneous_lookup")
async def test_new_code_collision_is_a_conflict_and_rolls_back_the_losing_batch(
    import_database: Database,
) -> None:
    results = await asyncio.gather(
        import_batch(import_database, "first"),
        import_batch(import_database, "second"),
        return_exceptions=True,
    )
    failures = [result for result in results if isinstance(result, Exception)]
    assert len(failures) == 1
    assert isinstance(failures[0], PointCodeTaken)
    assert failures[0].http_status == 409
    async with import_database.session() as session:
        codes = list(
            await session.scalars(
                select(CollectPoint.code).where(
                    CollectPoint.source_id == SOURCE_ID,
                )
            )
        )
    assert set(codes) in ({"common", "first"}, {"common", "second"})


async def test_other_integrity_errors_are_not_reported_as_code_conflicts(
    import_database: Database,
) -> None:
    item = PointItemIn(code="invalid", name="温度", address="ns=2;s=invalid")
    point = CollectPoint(source_id=SOURCE_ID, **item.model_dump())
    point.name = ""
    with pytest.raises(IntegrityError):
        await flush_point(import_database, point)


async def flush_point(database: Database, point: CollectPoint) -> None:
    async with database.session() as session:
        session.add(point)
        await _flush_import(session)
