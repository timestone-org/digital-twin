"""报告 worker、定时生成、导入与并发去重。"""

import asyncio
import io
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from docx import Document
from sqlalchemy import delete
from unit.source_fakes import InMemoryStream

from integration.dataset_helpers import data_of
from lib.db import Database
from platform_server.apps.report.models import (
    ReportAudit,
    ReportRender,
    ReportTemplate,
)
from platform_server.apps.report.schemas.jobs import RenderCreateIn
from platform_server.apps.report.schemas.template import ReportTemplateCreateIn
from platform_server.apps.report.services.render_service import (
    CONTENT_TYPE,
    RenderContext,
    start_render,
)
from platform_server.apps.report.services.scheduler import ReportScheduler
from platform_server.apps.report.services.template_service import (
    create_template,
)
from platform_server.apps.report.services.worker import (
    ReportWorker,
    WordPool,
    WorkerOptions,
)

pytestmark = pytest.mark.requires_postgres
PREFIX = "/api/v1/platform"


async def test_worker_generates_downloadable_word(app_context, stream, sign):
    client = app_context.client
    created = await client.post(
        f"{PREFIX}/report-templates",
        json={
            "code": "report_" + uuid.uuid4().hex,
            "name": "可下载报告",
            "doc_json": {
                "type": "doc",
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "自动生成的内容"}],
                    }
                ],
            },
        },
    )
    assert created.status_code == 201
    submitted = await client.post(
        f"{PREFIX}/report-renders",
        json={"template_id": data_of(created)["id"], "period": "2026-08"},
    )
    render_id = uuid.UUID(data_of(submitted)["id"])
    pool = WordPool()
    worker = ReportWorker(
        WorkerOptions(
            database=app_context.sessions,
            stream=stream,
            store=app_context.object_store,
            consumer="test",
        ),
        pool,
    )
    try:
        await worker.execute(render_id)
        await worker.execute(render_id)
    finally:
        pool.close()
    state = await client.get(f"{PREFIX}/report-renders/{render_id}")
    assert data_of(state)["status"] == "succeeded", state.text
    downloaded = await client.get(f"{PREFIX}/report-renders/{render_id}/files")
    assert downloaded.status_code == 200
    assert downloaded.content.startswith(b"PK")
    viewer = await client.get(
        f"{PREFIX}/report-renders/{render_id}",
        headers=sign(codes=("report:view",)),
    )
    assert data_of(viewer)["preview"] is None


async def test_scheduler_generates_once_per_period(app_context, stream):
    client = app_context.client
    created = await client.post(
        f"{PREFIX}/report-templates",
        json={"code": "auto_" + uuid.uuid4().hex, "name": "定期报告"},
    )
    template_id = data_of(created)["id"]
    rule = await client.post(
        f"{PREFIX}/report-schedules",
        json={"template_id": template_id, "name": "月报", "delay_hours": 0},
    )
    assert rule.status_code == 201
    options = WorkerOptions(
        database=app_context.sessions,
        stream=stream,
        store=app_context.object_store,
        consumer="test",
    )
    now = datetime(2026, 9, 6, tzinfo=UTC)
    disabled = ReportScheduler(options, "Asia/Shanghai", False)
    await disabled.tick(now)
    assert data_of(await client.get(f"{PREFIX}/report-renders"))["items"] == []
    scheduler = ReportScheduler(options, "Asia/Shanghai", True)
    await scheduler.tick(now)
    await scheduler.tick(now)
    jobs = data_of(await client.get(f"{PREFIX}/report-renders"))["items"]
    assert len(jobs) == 1
    assert jobs[0]["period"] == "2026-08"
    assert (
        await client.delete(f"{PREFIX}/report-schedules/{data_of(rule)['id']}")
    ).status_code == 409
    scheduler.stop()
    await scheduler.drain(1)


async def test_import_runs_in_worker_and_preserves_loss_report(
    app_context, stream
):
    client = app_context.client
    ticket_response = await client.post(
        f"{PREFIX}/report-templates:upload-ticket", json={"size_bytes": 100000}
    )
    assert ticket_response.status_code == 200, ticket_response.text
    ticket = data_of(ticket_response)
    document = Document()
    document.add_paragraph("导入的正文")
    content = io.BytesIO()
    document.save(content)
    await app_context.object_store.put_bytes(
        ticket["object_key"], content.getvalue(), content_type=CONTENT_TYPE
    )
    submitted = await client.post(
        f"{PREFIX}/report-templates:import",
        json={"object_key": ticket["object_key"]},
    )
    assert submitted.status_code == 202, submitted.text
    pool = WordPool()
    worker = ReportWorker(
        WorkerOptions(
            database=app_context.sessions,
            stream=stream,
            store=app_context.object_store,
            consumer="test",
        ),
        pool,
    )
    try:
        await worker.execute(uuid.UUID(data_of(submitted)["id"]))
    finally:
        pool.close()
    result = data_of(
        await client.get(f"{PREFIX}/report-renders/{data_of(submitted)['id']}")
    )
    assert result["status"] == "succeeded"
    assert (
        result["imported"]["doc_json"]["content"][0]["content"][0]["text"]
        == "导入的正文"
    )
    rejected = await client.post(
        f"{PREFIX}/report-templates:import",
        json={"object_key": "reports/imports/another-user/file.docx"},
    )
    assert rejected.status_code == 400


async def test_worker_loop_acknowledges_terminal_and_invalid_messages(
    app_context,
):
    stream = AcknowledgingStream()
    pool = WordPool()
    worker = ReportWorker(
        WorkerOptions(
            database=app_context.sessions,
            stream=stream,
            store=app_context.object_store,
            consumer="test",
        ),
        pool,
    )
    stream.on_ack = worker.stop
    await stream.publish("report", {"envelope_version": "wrong"})
    try:
        await worker.run()
        await worker.drain(1)
    finally:
        pool.close()
    assert len(stream.acked) == 1
    assert not stream.pending


class AcknowledgingStream(InMemoryStream):
    on_ack: Callable[[], None] = lambda: None

    async def ack(self, target, entry_id):
        await super().ack(target, entry_id)
        self.on_ack()


async def test_concurrent_idempotent_submissions_share_one_job(settings):
    database = Database(dsn=settings.dsn(), search_path="platform")
    actor = str(uuid.uuid4())
    stream = InMemoryStream()
    async with database.session() as session:
        template = await create_template(
            session,
            ReportTemplateCreateIn(
                code="parallel_" + uuid.uuid4().hex, name="并发报告"
            ),
            actor,
        )
    payload = RenderCreateIn(template_id=template.id, period="2026-08")
    context = RenderContext(
        actor=actor, stream=stream, timezone="UTC", idempotency_key="concurrent"
    )

    async def submit():
        async with database.session() as session:
            return await start_render(session, payload, context)

    try:
        first, second = await asyncio.gather(submit(), submit())
        assert first.id == second.id
        assert len(stream.entries) == 1
    finally:
        async with database.session() as session:
            await session.execute(
                delete(ReportAudit).where(ReportAudit.actor_id == actor)
            )
            await session.execute(
                delete(ReportRender).where(ReportRender.created_by == actor)
            )
            await session.execute(
                delete(ReportTemplate).where(ReportTemplate.id == template.id)
            )
        await database.dispose()


async def test_report_drain_timeout_does_not_abort_worker_shutdown(app_context):
    client = app_context.client
    created = data_of(
        await client.post(
            f"{PREFIX}/report-templates",
            json={"code": "drain_" + uuid.uuid4().hex, "name": "关停报告"},
        )
    )
    submitted = data_of(
        await client.post(
            f"{PREFIX}/report-renders",
            json={"template_id": created["id"], "period": "2026-08"},
        )
    )
    stream = InMemoryStream()
    runner = WaitingWordRunner()
    worker = ReportWorker(
        WorkerOptions(
            database=app_context.sessions,
            stream=stream,
            store=app_context.object_store,
            consumer="test",
        ),
        runner,
    )
    await stream.publish(
        "report",
        {
            "envelope_version": "1",
            "render_id": submitted["id"],
            "traceparent": (
                "00-0123456789abcdef0123456789abcdef-" "0123456789abcdef-01"
            ),
        },
    )
    task = asyncio.create_task(worker.run())
    try:
        await runner.started.wait()
        worker.stop()
        await worker.drain(0)
        assert not stream.acked
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


class WaitingWordRunner:
    def __init__(self):
        self.started = asyncio.Event()

    async def run(self, _task, _timeout_s):
        self.started.set()
        await asyncio.Event().wait()
        raise AssertionError("测试应在生成完成前取消")
