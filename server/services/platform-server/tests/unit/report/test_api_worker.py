"""API 出稿的事务边界、必要数据失败与不可变映射快照。"""

import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.report.test_api_binding import api_snapshot, api_template

from platform_server.apps.report.errors import (
    ReportApiReadFailed,
    ReportInvalid,
)
from platform_server.apps.report.models import ReportRender
from platform_server.apps.report.schemas.document import MetricDef
from platform_server.apps.report.services import worker
from platform_server.apps.report.services.word_task import WordTaskResult
from platform_server.apps.report.services.worker import (
    ReportWorker,
    WorkerOptions,
)

TRACE = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"


class Sessions:
    def __init__(self):
        self.active = 0

    @asynccontextmanager
    async def session(self):
        self.active += 1
        try:
            async with AsyncSession() as session:
                yield session
        finally:
            self.active -= 1


def assemble_worker(monkeypatch):
    body = api_template(
        metrics=[
            MetricDef(name="总量", table="api:energy", key="value", agg="sum")
        ]
    )
    row = ReportRender(
        id=uuid.uuid4(),
        kind="render",
        object_key=None,
        created_by="author",
        snapshot_json=body.model_dump(mode="json"),
        period="2026-09",
        timezone="UTC",
    )
    monkeypatch.setattr(worker.renders, "claim", AsyncMock(return_value=row))
    completed = AsyncMock(return_value=True)
    monkeypatch.setattr(worker.renders, "finish", completed)
    sessions = Sessions()
    store = SimpleNamespace(put_bytes=AsyncMock())
    pool = SimpleNamespace(
        run=AsyncMock(
            return_value=WordTaskResult(payload=b"document", warnings=())
        )
    )
    options = WorkerOptions(
        database=sessions,
        stream=SimpleNamespace(),
        store=store,
        consumer="test",
    )
    return ReportWorker(options, pool), row, sessions, pool, completed


async def test_worker_queries_outside_transactions_and_saves_mapped_snapshot(
    monkeypatch,
):
    consumer, row, sessions, pool, completed = assemble_worker(monkeypatch)

    async def fetch(*_arguments):
        assert sessions.active == 0
        return api_snapshot()

    reader = AsyncMock(side_effect=fetch)
    monkeypatch.setattr(worker, "fetch_api_sources", reader)
    assert await consumer.execute(row.id)
    reader.assert_awaited_once()
    task = pool.run.await_args.args[0]
    assert task.preview.metrics[0].value == "0.3"
    changes = completed.await_args.args[2]
    assert changes["status"] == "succeeded"
    saved = changes["result_json"]
    assert saved["api_data"]["api:energy"]["rows"][0]["values"] == {
        "value": "0.1"
    }
    assert "connection" not in saved["api_data"]["api:energy"]
    assert "headers" not in str(saved)


async def test_missing_necessary_values_fail_before_word_generation(
    monkeypatch,
):
    consumer, row, _sessions, pool, completed = assemble_worker(monkeypatch)
    monkeypatch.setattr(
        worker, "fetch_api_sources", AsyncMock(return_value=api_snapshot(0))
    )
    await consumer._handle(
        {
            "envelope_version": "1",
            "traceparent": TRACE,
            "render_id": str(row.id),
        }
    )
    pool.run.assert_not_awaited()
    changes = completed.await_args.args[2]
    assert changes["status"] == "failed"
    assert "数据检查未通过" in changes["error"]


async def test_api_read_failure_is_visible_and_does_not_generate_word(
    monkeypatch,
):
    consumer, row, _sessions, pool, completed = assemble_worker(monkeypatch)
    monkeypatch.setattr(
        worker,
        "fetch_api_sources",
        AsyncMock(
            side_effect=ReportApiReadFailed("API 接口连接失败，请检查授权")
        ),
    )
    await consumer._handle(
        {
            "envelope_version": "1",
            "traceparent": TRACE,
            "render_id": str(row.id),
        }
    )
    pool.run.assert_not_awaited()
    assert (
        completed.await_args.args[2]["error"] == "API 接口连接失败，请检查授权"
    )


async def test_mapping_failure_propagates_from_execute(monkeypatch):
    consumer, row, _sessions, pool, _completed = assemble_worker(monkeypatch)
    monkeypatch.setattr(
        worker,
        "fetch_api_sources",
        AsyncMock(side_effect=ReportInvalid("API 字段缺失")),
    )
    with pytest.raises(ReportInvalid, match="字段缺失"):
        await consumer.execute(row.id)
    pool.run.assert_not_awaited()
