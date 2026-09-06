"""提交后投递、队列信封与进程池恢复。"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.source_fakes import InMemoryStream

from lib.db import run_after_commit_hooks
from platform_server.apps.report.models import ReportRender
from platform_server.apps.report.schemas.preview import PreviewOut
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.render_service import enqueue
from platform_server.apps.report.services.word_task import WordTask, run_task
from platform_server.apps.report.services.worker import WordPool


def valid_task():
    return WordTask(
        template=TemplateBody(name="报告"),
        preview=PreviewOut(
            is_valid=True,
            period="2026-08",
            timezone="UTC",
            metrics=[],
            nodes={},
            warnings=[],
        ),
    )


async def test_queue_publish_only_after_commit_and_keeps_trace():
    stream = InMemoryStream()
    render_id = uuid.uuid4()
    trace = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"
    row = ReportRender(id=render_id, traceparent=trace)
    async with AsyncSession() as session:
        enqueue(session, row, stream)
        assert not stream.entries
        await run_after_commit_hooks(session)
    assert stream.entries[0].fields == {
        "envelope_version": "1",
        "render_id": str(render_id),
        "traceparent": trace,
        "idempotency_key": str(render_id),
    }


async def test_pool_timeout_does_not_block_next_report():
    pool = WordPool()
    try:
        with pytest.raises(TimeoutError):
            await pool.run(valid_task(), 0)
        result = await pool.run(valid_task(), 15)
        assert result.payload is not None
        assert result.payload.startswith(b"PK")
    finally:
        pool.close()


def test_synchronous_task_produces_real_document():
    result = run_task(valid_task())
    assert result.payload is not None
    assert result.payload.startswith(b"PK")
