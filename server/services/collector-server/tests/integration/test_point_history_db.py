"""守归档宽表本身：超表的分块与段键、主键去重、质量约束与两列值编码。

⚠ 打真实 TimescaleDB：超表、压缩设置与 `ON CONFLICT` 在 SQLite 上要么不存在
要么行为不同，而这张表的每一条决策都只在真库上才成立（COLLECT_DESIGN.md §6）。
"""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from collector_server.apps.collect.crud.point_history import (
    MAX_INSERT_ROWS,
    PointHistoryCrud,
)
from collector_server.apps.collect.services import PointHistoryService
from lib.db import Database
from timeseries import read_value

pytestmark = pytest.mark.requires_postgres

TABLE = "collect.point_history"
BASE_TS = datetime(2026, 8, 14, 0, 0, tzinfo=UTC)
CHUNK_INTERVAL_HOURS = 6
BATCH_ROWS = 1000


def make_row(
    source_id: UUID, *, point_code: str = "outlet_temp", **overrides: Any
) -> dict[str, Any]:
    """一行归档表的行。

    Args: source_id, point_code, **overrides。
    """
    row: dict[str, Any] = {
        "source_id": source_id,
        "point_code": point_code,
        "ts": BASE_TS,
        "value_num": 21.5,
        "value_text": None,
        "quality": "good",
    }
    row.update(overrides)
    return row


async def fetch(database: Database, source_id: UUID) -> Sequence[Any]:
    """按时刻取回一个数据源的全部历史。

    Args: database, source_id。
    """
    async with database.session() as session:
        result = await session.execute(
            text(
                f"SELECT point_code, ts, value_num, value_text, quality "  # noqa: S608  # 表名是本文件的字面常量
                f"FROM {TABLE} WHERE source_id = :source_id ORDER BY ts"
            ),
            {"source_id": str(source_id)},
        )
        return result.all()


async def cleanup(database: Database, source_id: UUID) -> None:
    """删掉一个数据源写进去的行。

    Args: database, source_id。
    """
    async with database.session() as session:
        await session.execute(
            text(
                f"DELETE FROM {TABLE} WHERE source_id = :source_id"  # noqa: S608  # 同上
            ),
            {"source_id": str(source_id)},
        )


@pytest.fixture
def store(database: Database) -> PointHistoryService:
    """打真库的落库面。"""
    return PointHistoryService(database=database, batch_rows=BATCH_ROWS)


async def test_the_history_table_is_a_hypertable_partitioned_by_time(
    database: Database,
) -> None:
    async with database.session() as session:
        result = await session.execute(
            text(
                "SELECT column_name, time_interval "
                "FROM timescaledb_information.dimensions "
                "WHERE hypertable_schema = 'collect' "
                "AND hypertable_name = 'point_history'"
            )
        )
        assert result.all() == [("ts", timedelta(hours=CHUNK_INTERVAL_HOURS))]


async def test_the_segment_key_is_source_and_point_in_that_order(
    database: Database,
) -> None:
    async with database.session() as session:
        result = await session.execute(
            text(
                "SELECT attname "
                "FROM timescaledb_information.compression_settings "
                "WHERE hypertable_schema = 'collect' "
                "AND hypertable_name = 'point_history' "
                "AND segmentby_column_index IS NOT NULL "
                "ORDER BY segmentby_column_index"
            )
        )
        assert [row[0] for row in result.all()] == ["source_id", "point_code"]


async def test_the_segments_are_ordered_by_time_descending(
    database: Database,
) -> None:
    async with database.session() as session:
        result = await session.execute(
            text(
                "SELECT attname, orderby_asc "
                "FROM timescaledb_information.compression_settings "
                "WHERE hypertable_schema = 'collect' "
                "AND hypertable_name = 'point_history' "
                "AND orderby_column_index IS NOT NULL"
            )
        )
        assert result.all() == [("ts", False)]


async def test_a_repeated_row_does_not_become_a_second_row(
    database: Database, store: PointHistoryService
) -> None:
    source_id = uuid4()
    try:
        await store.store([make_row(source_id)])
        await store.store([make_row(source_id, value_num=99.0)])
        rows = await fetch(database, source_id)
        assert [row[2] for row in rows] == [21.5]
    finally:
        await cleanup(database, source_id)


async def test_a_repeat_reports_zero_rows_stored(
    database: Database, store: PointHistoryService
) -> None:
    source_id = uuid4()
    try:
        await store.store([make_row(source_id)])
        assert await store.store([make_row(source_id)]) == 0
    finally:
        await cleanup(database, source_id)


async def test_the_same_point_at_another_time_is_a_new_row(
    database: Database, store: PointHistoryService
) -> None:
    source_id = uuid4()
    try:
        await store.store(
            [
                make_row(source_id),
                make_row(source_id, ts=BASE_TS + timedelta(seconds=10)),
            ]
        )
        assert len(await fetch(database, source_id)) == 2
    finally:
        await cleanup(database, source_id)


async def test_readings_six_hours_apart_land_in_different_chunks(
    database: Database, store: PointHistoryService
) -> None:
    source_id = uuid4()
    try:
        await store.store(
            [
                make_row(source_id),
                make_row(source_id, ts=BASE_TS + timedelta(hours=1)),
                make_row(
                    source_id,
                    ts=BASE_TS + timedelta(hours=CHUNK_INTERVAL_HOURS),
                ),
            ]
        )
        async with database.session() as session:
            result = await session.execute(
                text(
                    "SELECT count(DISTINCT tableoid) "  # noqa: S608  # 同上
                    f"FROM {TABLE} WHERE source_id = :source_id"
                ),
                {"source_id": str(source_id)},
            )
            assert result.scalar_one() == 2
    finally:
        await cleanup(database, source_id)


async def test_an_unknown_quality_word_is_refused_by_the_database(
    store: PointHistoryService,
) -> None:
    with pytest.raises(IntegrityError):
        await store.store([make_row(uuid4(), quality="excellent")])


@pytest.mark.parametrize(
    ("value_num", "value_text", "expected"),
    [
        (21.5, None, 21.5),
        (1.0, None, 1.0),
        (None, '"running"', "running"),
        (None, None, None),
    ],
    ids=["number", "boolean-as-number", "text", "null"],
)
async def test_a_value_reads_back_as_it_was_written(
    database: Database,
    store: PointHistoryService,
    value_num: float | None,
    value_text: str | None,
    expected: object,
) -> None:
    source_id = uuid4()
    try:
        await store.store(
            [make_row(source_id, value_num=value_num, value_text=value_text)]
        )
        rows = await fetch(database, source_id)
        assert read_value(rows[0][2], rows[0][3]) == expected
    finally:
        await cleanup(database, source_id)


async def test_a_batch_larger_than_one_statement_still_lands_whole(
    database: Database,
) -> None:
    source_id = uuid4()
    store = PointHistoryService(database=database, batch_rows=2)
    try:
        await store.store(
            [
                make_row(source_id, ts=BASE_TS + timedelta(seconds=step))
                for step in range(5)
            ]
        )
        assert len(await fetch(database, source_id)) == 5
    finally:
        await cleanup(database, source_id)


def test_the_batch_size_is_capped_by_the_driver_parameter_limit(
    database: Database,
) -> None:
    store = PointHistoryService(database=database, batch_rows=1_000_000)
    assert store.batch_rows == MAX_INSERT_ROWS


def test_a_batch_size_of_zero_still_writes_one_row_at_a_time(
    database: Database,
) -> None:
    store = PointHistoryService(database=database, batch_rows=0)
    assert store.batch_rows == 1


async def test_an_empty_batch_touches_the_database_not_at_all(
    store: PointHistoryService,
) -> None:
    assert await store.store([]) == 0


async def test_an_empty_batch_never_reaches_the_driver(
    database: Database,
) -> None:
    async with database.session() as session:
        assert await PointHistoryCrud().insert_many(session, []) == 0
