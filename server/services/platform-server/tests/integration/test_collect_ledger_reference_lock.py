"""真实 PostgreSQL 中台账列写入与点位删除的并发顺序。"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import pytest
from sqlalchemy import delete, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from lib.utils.ids import uuid7
from platform_server.apps.collect.errors import PointInUse, PointNotFound
from platform_server.apps.collect.models import CollectPoint, CollectSource
from platform_server.apps.collect.services import point_service
from platform_server.apps.dataset.models import DatasetTable
from platform_server.apps.dataset.schemas import (
    ColumnCreateIn,
    ColumnUpdateIn,
    TableCreateIn,
)
from platform_server.apps.dataset.services import column_service, table_service
from platform_server.settings import Settings
from timeseries import compose_node_key

pytestmark = pytest.mark.requires_postgres


@dataclass(frozen=True)
class RefFixture:
    database: Database
    source_id: uuid.UUID
    point_id: uuid.UUID
    table_id: uuid.UUID

    @property
    def node_key(self) -> str:
        return compose_node_key(self.source_id, "Case:point")


async def _seed(database: Database) -> RefFixture:
    source_id, point_id = uuid7(), uuid7()
    async with database.session() as session:
        session.add(
            CollectSource(
                id=source_id,
                code=f"qa-{source_id.hex}",
                name="锁顺序验收",
                protocol="opcua",
                endpoint="opc.tcp://127.0.0.1:1/qa",
                read_mode="poll",
                poll_interval_ms=1000,
                is_enabled=False,
            )
        )
        await session.flush()
        session.add(
            CollectPoint(
                id=point_id,
                source_id=source_id,
                code="Case:point",
                name="温度",
                address="ns=2;s=fixture",
                data_type="float",
                sampling_interval_ms=1000,
                deadband=0,
                archive_enabled=False,
                archive_max_interval_ms=10_000,
            )
        )
        table = await table_service.create_table(
            session,
            payload=TableCreateIn(code=f"qa_{source_id.hex}", name="合成台账"),
        )
    return RefFixture(database, source_id, point_id, table.id)


@pytest.fixture
async def refs(
    settings: Settings, db_session: AsyncSession
) -> AsyncIterator[RefFixture]:
    del db_session
    database = Database(dsn=settings.dsn(), search_path="platform")
    fixture = await _seed(database)
    try:
        yield fixture
    finally:
        async with database.session() as session:
            await session.execute(
                delete(DatasetTable).where(DatasetTable.id == fixture.table_id)
            )
            await session.execute(
                delete(CollectSource).where(
                    CollectSource.id == fixture.source_id
                )
            )
        await database.dispose()


async def _bind(
    session: AsyncSession,
    fixture: RefFixture,
    node_key: str,
    *,
    key: str = "reading",
) -> uuid.UUID:
    payload = ColumnCreateIn(
        key=key, name=key, source="point", node_key=node_key
    )
    return (
        await column_service.create_column(
            session, table_id=fixture.table_id, payload=payload
        )
    ).id


@asynccontextmanager
async def _bounded_session(database: Database) -> AsyncIterator[AsyncSession]:
    async with database.session() as session:
        await session.execute(text("SET LOCAL lock_timeout = '250ms'"))
        yield session


async def _delete_point(
    session: AsyncSession, fixture: RefFixture, is_batch: bool
) -> None:
    if is_batch:
        await point_service.delete_points(
            session,
            point_ids=[fixture.point_id],
            ledger_references=column_service.count_point_references,
        )
    else:
        await point_service.delete_point(
            session,
            point_id=fixture.point_id,
            ledger_references=column_service.count_point_references,
        )


@pytest.mark.parametrize("is_batch", [False, True], ids=["single", "batch"])
async def test_committing_a_binding_first_blocks_deletion(
    refs: RefFixture, is_batch: bool
) -> None:
    alias = f"{{{refs.source_id.hex.upper()}}}:Case:point"
    async with refs.database.session() as binding:
        await _bind(binding, refs, alias if is_batch else refs.node_key)
        with pytest.raises(DBAPIError, match="lock timeout"):
            async with _bounded_session(refs.database) as deletion:
                await _delete_point(deletion, refs, is_batch)

    with pytest.raises(PointInUse):
        async with refs.database.session() as deletion:
            await _delete_point(deletion, refs, is_batch)


async def test_rebind_waits_for_delete_then_accepts_an_unresolved_key(
    refs: RefFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    old_key = compose_node_key(refs.source_id, "预配置")
    async with refs.database.session() as session:
        column_id = await _bind(session, refs, old_key)
    request = ColumnUpdateIn(node_key=refs.node_key)

    async def delay_commit(_session: AsyncSession) -> None:
        """让测试会话保留删除事务，直到另一条连接确实尝试换绑。"""

    async with refs.database.session() as deletion:
        with monkeypatch.context() as patch:
            patch.setattr(point_service, "_commit", delay_commit)
            await _delete_point(deletion, refs, is_batch=True)
        with pytest.raises(DBAPIError, match="lock timeout"):
            async with _bounded_session(refs.database) as binding:
                await column_service.update_column(
                    binding,
                    table_id=refs.table_id,
                    column_id=column_id,
                    payload=request,
                )

    async with refs.database.session() as binding:
        updated = await column_service.update_column(
            binding,
            table_id=refs.table_id,
            column_id=column_id,
            payload=request,
        )
        assert updated.node_key == refs.node_key
        with pytest.raises(PointNotFound):
            await point_service.require_point(binding, refs.point_id)


async def test_legacy_uuid_spellings_match_the_same_point_and_preserve_code(
    refs: RefFixture,
) -> None:
    alias = refs.source_id.hex.upper()
    async with refs.database.session() as session:
        await _bind(session, refs, f"{alias}:case:point", key="different_case")
        await _bind(session, refs, f"{{{alias}}}:Case:point", key="same_point")
    async with refs.database.session() as session:
        counts = await column_service.count_point_references(
            session, [refs.node_key]
        )
        assert counts == {refs.node_key: 1}
    with pytest.raises(PointInUse):
        async with refs.database.session() as deletion:
            await _delete_point(deletion, refs, is_batch=False)
