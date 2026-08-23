"""采集器的调度面：水位往哪推、什么时候不推、以及报不报脏。

⚠ 这几条守的是「不报错的错」：水位多推一格就是把那段时间**永久跳过**（此后只
能靠回填补），漏报脏则是大屏数值静默不更新——两样都没有任何告警。
"""

from datetime import timedelta

import pytest
from conftest import AppContext
from sqlalchemy import text
from unit.dataset_fakes import FakeSetSink

from integration.collector_helpers import (
    CLOSED,
    POINT,
    aggregate_table,
    rows_of,
    run_pass,
    set_watermark,
    watermark_of,
)
from integration.dataset_helpers import (
    DIRTY_KEY,
    TABLES,
    ArchiveWriter,
    Sample,
    create_column,
    data_of,
)
from lib.utils.ids import uuid7
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog

pytestmark = pytest.mark.requires_postgres


async def test_a_written_pass_reports_the_table_as_dirty(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # ⚠ 漏报的表现是大屏数值静默不更新，没有任何告警（§16）
    sink = FakeSetSink()
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    await archive.write(
        POINT, [Sample(ts=CLOSED + timedelta(minutes=5), value_num=10.0)]
    )
    await run_pass(
        app_context, (DatasetDirtyLog(sink=sink), archive), table_id=table["id"]
    )
    assert sink.members(DIRTY_KEY) == {table["code"]}


async def test_a_pass_that_writes_nothing_reports_nothing_dirty(
    app_context: AppContext, archive: ArchiveWriter
) -> None:
    # 大屏没必要为一个什么都没写的拍子再取一遍数
    sink = FakeSetSink()
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    await run_pass(
        app_context, (DatasetDirtyLog(sink=sink), archive), table_id=table["id"]
    )
    assert sink.members(DIRTY_KEY) == set()


async def test_the_table_list_shows_the_watermark_it_advanced_to(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    await archive.write(
        POINT, [Sample(ts=CLOSED + timedelta(minutes=5), value_num=10.0)]
    )
    await run_pass(app_context, (dirty, archive), table_id=table["id"])
    detail = await app_context.client.get(f"{TABLES}/{table['id']}")
    assert detail.status_code == 200, detail.text
    assert data_of(detail)["last_collected_ts"] == "2026-08-24T04:00:00.000Z"


async def test_a_table_deleted_mid_tick_is_simply_skipped(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    # 名单是在另一个事务里取的：轮到这张表时它可能已经被删了
    missing = str(uuid7())
    outcome = await run_pass(app_context, (dirty, archive), table_id=missing)
    assert outcome is None


async def test_a_table_already_caught_up_does_nothing(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    # 水位已经压在最后一个已关闭的桶上、且不做尾部重算时，这一拍无事可做
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    await archive.write(
        POINT, [Sample(ts=CLOSED + timedelta(minutes=5), value_num=10.0)]
    )
    await set_watermark(app_context, table["id"], CLOSED)
    outcome = await run_pass(
        app_context, (dirty, archive), table_id=table["id"]
    )
    assert outcome is not None
    assert outcome.buckets == 0
    assert outcome.written == 0
    assert await rows_of(app_context.client, table["id"]) == []
    assert await watermark_of(app_context, table["id"]) == CLOSED


async def test_a_table_without_point_columns_keeps_its_watermark(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    # ⚠ 推了水位就是把这段时间永久跳过：它此后只能靠回填补，而回填要人触发
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client, table["id"], key="产量", name="产量"
    )
    outcome = await run_pass(
        app_context, (dirty, archive), table_id=table["id"]
    )
    assert outcome is not None
    assert outcome.is_awaiting_columns is True
    assert await watermark_of(app_context, table["id"]) is None


async def test_a_column_with_a_broken_binding_is_skipped(
    app_context: AppContext, archive: ArchiveWriter, dirty: DatasetDirtyLog
) -> None:
    # 绑定串写坏的那一列跳过，同表的别的点位列照常出数
    table = await aggregate_table(app_context.client)
    await create_column(
        app_context.client,
        table["id"],
        key="均温",
        name="均温",
        source="point",
        node_key=archive.node_key(POINT),
        agg="avg",
    )
    # 入参层拦得住这种绑定串，故只能直接改库造出这个局面——它对应的是「点位
    # 改了名、而列上的绑定还留着旧串」那一类现场
    await app_context.session.execute(
        text(
            "UPDATE platform.dataset_columns SET node_key = '没有冒号'"
            " WHERE table_id = CAST(:table_id AS uuid) AND key = '均温'"
        ),
        {"table_id": table["id"]},
    )
    outcome = await run_pass(
        app_context, (dirty, archive), table_id=table["id"]
    )
    assert outcome is not None
    assert outcome.is_awaiting_columns is True
