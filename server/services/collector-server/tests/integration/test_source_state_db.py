"""守运行态表：一个数据源一行、覆盖写幂等、约束挡住非法取值。

⚠ 打真实 Postgres：SQLite 上全绿的迁移与约束可以在生产上直接失败
（testing-standard-python §6.3）。
"""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from collector_server.apps.collect.runtime.session import (
    STATE_OFFLINE,
    STATE_ONLINE,
    SourceStatus,
)
from collector_server.apps.collect.services import SourceStateService
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


async def test_a_source_keeps_exactly_one_row(database: Database) -> None:
    service = SourceStateService(database=database, instance="test-replica")
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
    database: Database,
) -> None:
    service = SourceStateService(database=database, instance="test-replica")
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
    database: Database,
) -> None:
    service = SourceStateService(database=database, instance="x" * 100000)
    source_id = uuid4()
    await service.report(
        SourceStatus(source_id=source_id, state="not-a-state", point_count=-1)
    )
    assert await _rows(database, source_id) == []
