"""守运行态表：一个数据源一行、覆盖写幂等、约束挡住非法取值。

⚠ 打真实 Postgres：SQLite 上全绿的迁移与约束可以在生产上直接失败
（testing-standard-python §6.3）。
"""

import asyncio
from typing import Any
from uuid import uuid4

import pytest
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from collector_server.apps.collect.runtime.session import SourceStatus
from collector_server.apps.collect.services import SourceStateService
from collector_server.lease import RedisLease
from collectwire import STATE_OFFLINE, STATE_ONLINE
from lib.db import Database

pytestmark = pytest.mark.requires_postgres

TABLE = "collect.collect_source_states"


async def _rows(database: Database, source_id: object) -> list[tuple[str, int]]:
    async with database.session() as session:
        result = await session.execute(
            text(
                f"SELECT state, point_count FROM {TABLE} "  # noqa: S608  # 表名是本文件的字面常量
                "WHERE source_id = :source_id"
            ),
            {"source_id": str(source_id)},
        )
        return [(row[0], row[1]) for row in result.all()]


async def _cleanup(database: Database, source_id: object) -> None:
    async with database.session() as session:
        await session.execute(
            text(
                f"DELETE FROM {TABLE} WHERE source_id = :source_id"  # noqa: S608  # 同上
            ),
            {"source_id": str(source_id)},
        )


async def test_a_source_keeps_exactly_one_row(
    database: Database, snapshot_lease: RedisLease
) -> None:
    service = _service(database, snapshot_lease)
    source_id = uuid4()
    try:
        await service.report(
            SourceStatus(source_id=source_id, state=STATE_ONLINE, point_count=3)
        )
        await service.report(
            SourceStatus(
                source_id=source_id, state=STATE_OFFLINE, point_count=3
            )
        )
        assert await _rows(database, source_id) == [(STATE_OFFLINE, 3)]
    finally:
        await _cleanup(database, source_id)


async def test_the_row_records_how_many_points_are_covered(
    database: Database, snapshot_lease: RedisLease
) -> None:
    service = _service(database, snapshot_lease)
    source_id = uuid4()
    try:
        await service.report(
            SourceStatus(
                source_id=source_id, state=STATE_ONLINE, point_count=12
            )
        )
        assert await _rows(database, source_id) == [(STATE_ONLINE, 12)]
    finally:
        await _cleanup(database, source_id)


async def test_an_unknown_state_is_refused_by_the_database(
    database: Database,
) -> None:
    source_id = uuid4()
    with pytest.raises(IntegrityError):
        async with database.session() as session:
            await session.execute(
                text(
                    f"INSERT INTO {TABLE} "  # noqa: S608  # 同上
                    "(source_id, state, point_count, leader_instance) "
                    "VALUES (:source_id, 'teleporting', 0, 'test')"
                ),
                {"source_id": str(source_id)},
            )


async def test_a_write_failure_does_not_reach_the_session_loop(
    database: Database, snapshot_lease: RedisLease
) -> None:
    service = _service(database, snapshot_lease)
    source_id = uuid4()
    await service.report(
        SourceStatus(source_id=source_id, state="not-a-state", point_count=-1)
    )
    assert await _rows(database, source_id) == []


async def test_old_transaction_cannot_overwrite_successor_online(
    database: Database,
    monkeypatch: pytest.MonkeyPatch,
    snapshot_lease: RedisLease,
) -> None:
    old = _service(database, snapshot_lease)
    previous_token = snapshot_lease.token
    source_id = uuid4()
    inside_write = asyncio.Event()
    resume = asyncio.Event()
    write = old._crud.upsert

    async def delayed(
        session: AsyncSession, status: SourceStatus, **kwargs: Any
    ) -> None:
        await session.execute(text("SELECT 1"))
        inside_write.set()
        await resume.wait()
        await write(session, status, **kwargs)

    monkeypatch.setattr(old._crud, "upsert", delayed)
    pending = asyncio.create_task(
        old.report(SourceStatus(source_id, STATE_OFFLINE, 0))
    )
    try:
        await asyncio.wait_for(inside_write.wait(), timeout=2)
        await snapshot_lease.release()
        assert await snapshot_lease.acquire()
        assert snapshot_lease.token != previous_token
        successor = _service(database, snapshot_lease)
        await successor.report(SourceStatus(source_id, STATE_ONLINE, 4))
        resume.set()
        await asyncio.wait_for(pending, timeout=2)
        assert await _rows(database, source_id) == [(STATE_ONLINE, 4)]
    finally:
        resume.set()
        await pending
        await _cleanup(database, source_id)


def _service(database: Database, lease: RedisLease) -> SourceStateService:
    return SourceStateService(
        database=database, instance="test-replica", lease=lease
    )


async def test_stale_cached_token_cannot_authorize_a_state_write(
    database: Database, snapshot_lease: RedisLease, redis_url: str
) -> None:
    service = _service(database, snapshot_lease)
    source_id = uuid4()
    async with Redis.from_url(redis_url, decode_responses=True) as client:
        await client.set(snapshot_lease.key, "successor", ex=30)
        try:
            await service.report(SourceStatus(source_id, STATE_OFFLINE, 0))
            assert await _rows(database, source_id) == []
        finally:
            await client.delete(snapshot_lease.key)
            await _cleanup(database, source_id)
