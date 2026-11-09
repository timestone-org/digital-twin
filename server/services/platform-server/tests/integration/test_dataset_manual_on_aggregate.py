"""按周期聚合的台账上人工录入：对齐到桶、落到采集那一行上。

⚠ 不对齐的话，同一个桶会长出第二行（一行「自动采集」、一行人填的），两行
看起来都对；对齐了却另起 row_id，也是同一个结果。
"""

from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from conftest import AppContext

from integration.collector_helpers import (
    CLOSED,
    POINT,
    aggregate_table,
    rows_of,
    run_pass,
)
from integration.dataset_helpers import (
    HTTP_BAD_REQUEST,
    HTTP_CONFLICT,
    HTTP_CREATED,
    ArchiveWriter,
    Sample,
    code_of,
    create_column,
    create_record,
    record_url,
    records_url,
)
from platform_server.apps.dataset.crud import record_crud
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog

pytestmark = pytest.mark.requires_postgres

RECORD_INVALID = 41213
RECORD_SLOT_TAKEN = 41208
OFF_GRID = CLOSED + timedelta(minutes=25, seconds=36)


async def _table_with_point_and_manual(
    context: AppContext, archive: ArchiveWriter
) -> str:
    """一张按小时聚合、带一根点位列和一根录入列的台账。"""
    table = await aggregate_table(context.client)
    await create_column(
        context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    await create_column(
        context.client, table["id"], key="备注值", name="备注值"
    )
    return str(table["id"])


async def test_a_manual_entry_snaps_to_the_bucket_start(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    table_id = await _table_with_point_and_manual(app_context, archive)

    created = await create_record(
        app_context.client,
        table_id,
        ts=OFF_GRID.isoformat(),
        values={"备注值": 1},
    )

    assert created["record"]["ts"] == "2026-08-24T04:00:00.000Z"


async def test_a_manual_entry_lands_on_the_collected_row_of_its_bucket(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    table_id = await _table_with_point_and_manual(app_context, archive)
    await archive.write(
        POINT, [Sample(ts=CLOSED + timedelta(minutes=5), value_num=21.0)]
    )
    await run_pass(app_context, (dirty, archive), table_id=table_id)
    collected = (await rows_of(app_context.client, table_id))[0]

    response = await app_context.client.post(
        records_url(table_id),
        json={"ts": OFF_GRID.isoformat(), "values": {"备注值": 1}},
    )

    assert response.status_code == HTTP_CREATED, response.text
    rows = await rows_of(app_context.client, table_id)
    assert len(rows) == 1
    assert rows[0]["row_id"] == collected["row_id"]
    assert rows[0]["values"] == {"均温": 21.0, "备注值": 1.0}


async def test_a_later_collection_merges_into_the_manual_row(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    table_id = await _table_with_point_and_manual(app_context, archive)
    await create_record(
        app_context.client,
        table_id,
        ts=OFF_GRID.isoformat(),
        values={"备注值": 1},
    )
    await archive.write(
        POINT, [Sample(ts=CLOSED + timedelta(minutes=5), value_num=21.0)]
    )

    await run_pass(app_context, (dirty, archive), table_id=table_id)

    rows = await rows_of(app_context.client, table_id)
    assert len(rows) == 1
    assert rows[0]["values"] == {"均温": 21.0, "备注值": 1.0}


async def test_a_manual_row_on_a_bucket_refuses_to_move_away(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 它的 row_id 由桶派生：挪走后下一拍会在原桶再插一行同 row_id 的行
    table_id = await _table_with_point_and_manual(app_context, archive)
    created = await create_record(
        app_context.client,
        table_id,
        ts=CLOSED.isoformat(),
        values={"备注值": 1},
    )
    row = created["record"]
    moved = (CLOSED + timedelta(hours=1)).isoformat()

    response = await app_context.client.patch(
        record_url(table_id, row["row_id"], row["ts"]),
        json={"ts": moved, "values": {}},
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert code_of(response) == RECORD_INVALID


async def test_a_bucket_taken_in_between_is_a_conflict_not_a_crash(
    app_context: AppContext,
    archive: ArchiveWriter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # ⚠ 先查后插挡不住同时到的两次写：后到的那个只会在插入时撞主键
    table_id = await _table_with_point_and_manual(app_context, archive)
    await create_record(
        app_context.client,
        table_id,
        ts=OFF_GRID.isoformat(),
        values={"备注值": 1},
    )
    monkeypatch.setattr(record_crud, "get_one", AsyncMock(return_value=None))

    response = await app_context.client.post(
        records_url(table_id),
        json={"ts": OFF_GRID.isoformat(), "values": {"备注值": 2}},
    )

    assert response.status_code == HTTP_CONFLICT, response.text
    assert code_of(response) == RECORD_SLOT_TAKEN
