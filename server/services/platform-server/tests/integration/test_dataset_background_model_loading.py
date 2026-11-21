"""采集与历史回填的公式模型下载不占写事务。"""

import uuid

import pytest
from conftest import AppContext

from integration.backfill_helpers import Backfiller, bucket_ago, seed
from integration.collector_helpers import CLOSED, run_pass
from integration.dataset_helpers import ArchiveWriter, create_column
from integration.test_dataset_backfill import a_point_table
from integration.test_dataset_model_transactions import observe_download
from integration.test_modeling_formula_preview import (
    binary_version,
    register_preview_table,
)
from platform_server.apps.dataset.schemas import BackfillStartIn
from platform_server.apps.dataset.services import backfill_service
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog

pytestmark = pytest.mark.requires_postgres


async def a_table_with_point_model(
    context: AppContext, archive: ArchiveWriter
) -> str:
    """用已发布模型计算采集桶。Args: context, archive。"""
    version = await binary_version(
        context.client, context.session, context.sessions, context.object_store
    )
    await register_preview_table(context.client, version)
    table_id = await a_point_table(context, archive)
    await create_column(
        context.client,
        table_id,
        key="预测",
        source="formula",
        formula="PREDICT('试算能耗', {均温}, 430)",
    )
    return table_id


async def test_collecting_a_bucket_prepares_the_model_outside_its_transaction(
    app_context: AppContext,
    archive: ArchiveWriter,
    dirty: DatasetDirtyLog,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    table = await a_table_with_point_model(app_context, archive)
    await seed(archive, CLOSED, 25.0)
    with observe_download(app_context, monkeypatch) as reads:
        outcome = await run_pass(app_context, (dirty, archive), table_id=table)
    assert outcome is not None
    assert outcome.written == 1
    assert reads == [0]


async def test_backfill_tail_prepares_the_model_outside_its_transaction(
    app_context: AppContext,
    archive: ArchiveWriter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    table = await a_table_with_point_model(app_context, archive)
    moment = bucket_ago(6)
    await seed(archive, moment, 25.0)
    runner = Backfiller(app_context, archive).runner()
    with observe_download(app_context, monkeypatch) as reads:
        started = await backfill_service.start_backfill(
            app_context.session,
            runner,
            table_id=uuid.UUID(table),
            payload=BackfillStartIn(since=moment, until=moment),
        )
        await app_context.session.commit()
        assert started.status == "running"
        await runner.drain(timeout_s=60)
    result = await backfill_service.read_progress(
        app_context.session, runner.jobs, table_id=uuid.UUID(table)
    )
    assert result is not None
    assert result.recomputed == 1
    assert reads == [0]


async def test_changing_collection_while_loading_keeps_the_old_watermark(
    app_context: AppContext,
    archive: ArchiveWriter,
    dirty: DatasetDirtyLog,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    table = await a_table_with_point_model(app_context, archive)
    await seed(archive, CLOSED, 25.0)
    original = app_context.object_store.get_bytes

    async def change_during_read(key: str) -> bytes:
        response = await app_context.client.patch(
            f"/api/v1/platform/dataset-tables/{table}",
            json={"is_enabled": False},
        )
        assert response.status_code == 200, response.text
        return await original(key)

    with observe_download(app_context, monkeypatch):
        monkeypatch.setattr(
            app_context.object_store, "get_bytes", change_during_read
        )
        outcome = await run_pass(app_context, (dirty, archive), table_id=table)
    assert outcome is not None
    assert outcome.written == 0
    assert outcome.watermark is None
