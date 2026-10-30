"""真实 PostgreSQL 与 Redis 上的报告投递恢复和执行幂等。"""

import asyncio
import socket
import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock
from urllib.parse import urlsplit, urlunsplit

import pytest
from redis.asyncio import Redis
from sqlalchemy import delete, select

from lib.db import Database
from lib.errors import DependencyUnavailable
from lib.stream import RedisStream, StreamGroup
from lib.testing import FakeObjectStore
from lib.utils.timeutils import format_rfc3339
from platform_server.apps.report.crud import renders
from platform_server.apps.report.errors import ReportQueueFull
from platform_server.apps.report.models import (
    ReportAudit,
    ReportRender,
    ReportSchedule,
    ReportTemplate,
)
from platform_server.apps.report.schemas.jobs import RenderCreateIn
from platform_server.apps.report.schemas.template import ReportTemplateCreateIn
from platform_server.apps.report.services import (
    dispatch,
    render_service,
    worker,
)
from platform_server.apps.report.services.dispatch import ReportDispatcher
from platform_server.apps.report.services.render_service import (
    RenderContext,
    start_render,
)
from platform_server.apps.report.services.scheduler import ReportScheduler
from platform_server.apps.report.services.template_service import (
    create_template,
)
from platform_server.apps.report.services.word_task import WordTaskResult
from platform_server.apps.report.services.worker import (
    ReportWorker,
    WorkerOptions,
)

pytestmark = pytest.mark.requires_postgres
TRACE = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"


@dataclass
class DispatchEnvironment:
    database: Database
    stream: RedisStream
    raw: Redis
    queue: str
    actor: str
    template_id: uuid.UUID
    store: FakeObjectStore
    redis_url: str = field(repr=False)

    def options(self):
        return WorkerOptions(
            database=self.database,
            stream=self.stream,
            store=self.store,
            consumer="dispatch-test",
        )


@pytest.fixture
async def dispatch_env(settings, redis_url, monkeypatch):
    database = Database(dsn=settings.dsn(), search_path="platform")
    queue = f"report:dispatch:test:{uuid.uuid4().hex}"
    for module in (dispatch, render_service, worker):
        monkeypatch.setattr(module, "STREAM", queue)
    stream = RedisStream(url=redis_url, timeout_s=2)
    raw = Redis.from_url(redis_url, decode_responses=True)
    actor = str(uuid.uuid4())
    async with database.session() as session:
        template = await create_template(
            session,
            ReportTemplateCreateIn(
                code="dispatch_" + uuid.uuid4().hex, name="可靠投递报告"
            ),
            actor,
        )
    environment = DispatchEnvironment(
        database,
        stream,
        raw,
        queue,
        actor,
        template.id,
        FakeObjectStore(),
        redis_url,
    )
    try:
        yield environment
    finally:
        await cleanup_dispatch(environment)


async def cleanup_dispatch(environment):
    database, template_id = environment.database, environment.template_id
    async with database.session() as session:
        targets = list(
            await session.scalars(
                select(ReportRender.id).where(
                    ReportRender.template_id == template_id
                )
            )
        )
        targets += list(
            await session.scalars(
                select(ReportSchedule.id).where(
                    ReportSchedule.template_id == template_id
                )
            )
        )
        await session.execute(
            delete(ReportAudit).where(
                ReportAudit.target_id.in_([template_id, *targets])
            )
        )
        await session.execute(
            delete(ReportRender).where(ReportRender.template_id == template_id)
        )
        await session.execute(
            delete(ReportSchedule).where(
                ReportSchedule.template_id == template_id
            )
        )
        await session.execute(
            delete(ReportTemplate).where(ReportTemplate.id == template_id)
        )
    await environment.raw.delete(environment.queue)
    await environment.raw.aclose()
    await environment.stream.close()
    await database.dispose()


async def committed_pending(environment, *, age_days=0):
    now = datetime.now(UTC) - timedelta(days=age_days)
    async with environment.database.session() as session:
        template = await session.get(ReportTemplate, environment.template_id)
        row = ReportRender(
            template_id=template.id,
            created_by=environment.actor,
            snapshot_json=template.body_json,
            period="2026-10",
            granularity="month",
            timezone="UTC",
            kind="render",
            traceparent=TRACE,
            created_at=now,
            updated_at=now,
        )
        await renders.add(session, row)
    return row.id


async def load_job(environment, render_id):
    async with environment.database.session() as session:
        return await renders.get(session, render_id)


async def make_due(environment, render_id):
    async with environment.database.session() as session:
        row = await renders.get(session, render_id)
        state = dict((row.result_json or {}).get("_dispatch", {}))
        now = await renders.dispatch_clock(session)
        state["next_attempt_at"] = format_rfc3339(now - timedelta(seconds=1))
        row.result_json = {"_dispatch": state}


async def queue_entries(environment):
    target = StreamGroup(environment.queue, "dispatch-test", uuid.uuid4().hex)
    await environment.stream.ensure_group(target)
    return await environment.stream.read_group(target, count=100, block_ms=10)


async def test_old_unpublished_task_recovers_with_schedule_disabled(
    dispatch_env,
):
    identity = await committed_pending(dispatch_env, age_days=3)
    scheduler = ReportScheduler(dispatch_env.options(), "UTC", False)
    await scheduler.tick(datetime.now(UTC))
    row = await load_job(dispatch_env, identity)
    assert row.status == "pending"
    entries = await queue_entries(dispatch_env)
    assert len(entries) == 1
    assert entries[0].fields["traceparent"] == TRACE
    assert entries[0].fields["render_id"] == str(identity)


async def test_concurrent_dispatchers_publish_once_and_cooldown_prevents_storm(
    dispatch_env,
):
    await committed_pending(dispatch_env)
    first = ReportDispatcher(dispatch_env.database, dispatch_env.stream)
    second = ReportDispatcher(dispatch_env.database, dispatch_env.stream)
    results = await asyncio.gather(first.tick(), second.tick())
    assert sum(results) == 1
    assert await first.tick() == 0
    assert await dispatch_env.raw.xlen(dispatch_env.queue) == 1


async def test_expired_token_cannot_publish_or_replace_new_dispatch_owner(
    dispatch_env,
):
    identity = await committed_pending(dispatch_env)
    dispatcher = ReportDispatcher(dispatch_env.database, dispatch_env.stream)
    old = await dispatcher._take()
    await make_due(dispatch_env, identity)
    assert not await dispatcher._deliver(old)
    replacement = await dispatcher._take()
    assert old is not None
    assert replacement is not None
    assert not await dispatcher._deliver(old)
    await dispatcher._save(old, "old-message")
    row = await load_job(dispatch_env, identity)
    assert row.result_json["_dispatch"]["token"] == replacement.token
    assert await dispatch_env.raw.xlen(dispatch_env.queue) == 0
    assert await dispatcher._deliver(replacement)
    assert await dispatch_env.raw.xlen(dispatch_env.queue) == 1


async def test_unknown_publish_outcome_can_repeat_message_but_not_execution(
    dispatch_env, monkeypatch
):
    identity = await committed_pending(dispatch_env)
    original = dispatch_env.stream.publish

    async def uncertain(stream, fields):
        await original(stream, fields)
        raise DependencyUnavailable("连接在投递后中断")

    monkeypatch.setattr(dispatch_env.stream, "publish", uncertain)
    dispatcher = ReportDispatcher(dispatch_env.database, dispatch_env.stream)
    assert await dispatcher.tick() == 0
    monkeypatch.setattr(dispatch_env.stream, "publish", original)
    await make_due(dispatch_env, identity)
    assert await dispatcher.tick() == 1
    entries = await queue_entries(dispatch_env)
    assert len(entries) == 2
    pool = AsyncMock()
    pool.run.return_value = WordTaskResult(payload=b"document", warnings=())
    api_reader = AsyncMock(return_value={})
    monkeypatch.setattr(worker, "fetch_api_sources", api_reader)
    consumer = ReportWorker(dispatch_env.options(), pool)
    await asyncio.gather(*(consumer._handle(entry.fields) for entry in entries))
    assert (await load_job(dispatch_env, identity)).status == "succeeded"
    pool.run.assert_awaited_once()
    api_reader.assert_awaited_once()


async def test_running_tasks_expire_by_start_time_without_requeue(dispatch_env):
    old_pending = await committed_pending(dispatch_env, age_days=3)
    interrupted = await committed_pending(dispatch_env)
    fresh = await committed_pending(dispatch_env)
    now = datetime.now(UTC)
    async with dispatch_env.database.session() as session:
        await renders.claim(session, interrupted, now - timedelta(minutes=20))
        await renders.claim(session, fresh, now)
    await ReportScheduler(dispatch_env.options(), "UTC", False).tick(now)
    assert (await load_job(dispatch_env, old_pending)).status == "pending"
    assert (await load_job(dispatch_env, interrupted)).status == "failed"
    assert (await load_job(dispatch_env, interrupted)).result_json is None
    assert (await load_job(dispatch_env, fresh)).status == "running"
    entries = await queue_entries(dispatch_env)
    assert [entry.fields["render_id"] for entry in entries] == [
        str(old_pending)
    ]


def disconnected_stream(environment):
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    parsed = urlsplit(environment.redis_url)
    credentials = parsed.netloc.rpartition("@")[0]
    netloc = (credentials + "@" if credentials else "") + f"127.0.0.1:{port}"
    endpoint = urlunsplit(parsed._replace(netloc=netloc))
    return RedisStream(url=endpoint, timeout_s=0.2), probe


async def submit_during_outage(environment, now):
    context = RenderContext(
        actor=environment.actor, stream=environment.stream, timezone="UTC"
    )
    async with environment.database.session() as session:
        accepted = await start_render(
            session,
            RenderCreateIn(
                template_id=environment.template_id, period="2026-10"
            ),
            context,
        )
    scheduler = ReportScheduler(environment.options(), "UTC", False)
    await make_due(environment, accepted.id)
    await scheduler.tick(now + timedelta(seconds=61))
    row = await load_job(environment, accepted.id)
    assert row.status == "pending"
    assert row.result_json["_dispatch"]["attempts"] == 1
    return accepted.id


async def test_stopped_redis_keeps_committed_jobs_until_recovery(dispatch_env):
    original = dispatch_env.stream
    unavailable, probe = disconnected_stream(dispatch_env)
    dispatch_env.stream = unavailable
    now = datetime.now(UTC)
    try:
        identity = await submit_during_outage(dispatch_env, now)
    finally:
        dispatch_env.stream = original
        await unavailable.close()
        probe.close()
    dispatcher = ReportDispatcher(dispatch_env.database, dispatch_env.stream)
    await make_due(dispatch_env, identity)
    assert await dispatcher.tick() == 1
    entries = await queue_entries(dispatch_env)
    assert len(entries) == 1
    row = await load_job(dispatch_env, identity)
    assert entries[0].fields["traceparent"] == row.traceparent
    pool = AsyncMock()
    pool.run.return_value = WordTaskResult(payload=b"document", warnings=())
    await ReportWorker(dispatch_env.options(), pool)._handle(entries[0].fields)
    assert (await load_job(dispatch_env, identity)).status == "succeeded"
    pool.run.assert_awaited_once()


async def test_same_schedule_period_stays_unique_with_real_queue(dispatch_env):
    async with dispatch_env.database.session() as session:
        rule = ReportSchedule(
            template_id=dispatch_env.template_id,
            name="月报",
            granularity="month",
            delay_hours=0,
            is_enabled=True,
        )
        session.add(rule)
        await session.flush()
        identity = rule.id
    now = datetime.now(UTC)
    first = ReportScheduler(dispatch_env.options(), "UTC", True)
    second = ReportScheduler(dispatch_env.options(), "UTC", True)
    await asyncio.gather(first.tick(now), second.tick(now))
    async with dispatch_env.database.session() as session:
        rows = list(
            await session.scalars(
                select(ReportRender).where(ReportRender.schedule_id == identity)
            )
        )
    assert len(rows) == 1
    entries = await queue_entries(dispatch_env)
    assert len(entries) == 1
    pool = AsyncMock()
    pool.run.return_value = WordTaskResult(payload=b"document", warnings=())
    consumer = ReportWorker(dispatch_env.options(), pool)
    await consumer._handle(entries[0].fields)
    await consumer._handle(entries[0].fields)
    pool.run.assert_awaited_once()


async def test_worker_claim_accepts_pending_delivery_metadata(dispatch_env):
    identity = await committed_pending(dispatch_env)
    dispatcher = ReportDispatcher(dispatch_env.database, dispatch_env.stream)
    attempt = await dispatcher._take()
    assert attempt is not None
    pool = AsyncMock()
    pool.run.return_value = WordTaskResult(payload=b"document", warnings=())
    first = ReportWorker(dispatch_env.options(), pool)
    second = ReportWorker(dispatch_env.options(), pool)
    results = await asyncio.gather(
        first.execute(identity), second.execute(identity)
    )
    assert sorted(results) == [False, True]
    assert (await load_job(dispatch_env, identity)).status == "succeeded"
    pool.run.assert_awaited_once()


def stop_after_generation(environment):
    pool = AsyncMock()
    consumer = ReportWorker(environment.options(), pool)

    async def generate(_task, _timeout_s):
        consumer.stop()
        return WordTaskResult(payload=b"document", warnings=())

    pool.run.side_effect = generate
    return consumer, pool


async def test_worker_started_during_redis_outage_recovers_its_group(
    dispatch_env,
):
    consumer, pool = stop_after_generation(dispatch_env)
    unavailable, probe = disconnected_stream(dispatch_env)
    consumer._options = replace(consumer._options, stream=unavailable)
    background = None
    try:
        background = asyncio.create_task(consumer.run())
        identity = await committed_pending(dispatch_env)
        await asyncio.sleep(0.05)
        assert not background.done()
    finally:
        consumer._options = dispatch_env.options()
        await unavailable.close()
        probe.close()
    try:
        await ReportDispatcher(
            dispatch_env.database, dispatch_env.stream
        ).tick()
        await asyncio.wait_for(background, timeout=5)
    finally:
        consumer.stop()
        if background is not None:
            background.cancel()
            await asyncio.gather(background, return_exceptions=True)
    assert (await load_job(dispatch_env, identity)).status == "succeeded"
    pool.run.assert_awaited_once()


async def test_concurrent_submissions_share_the_last_capacity_slot(
    dispatch_env, monkeypatch
):
    original = renders.active_count

    async def delayed_count(session):
        found = await original(session)
        await asyncio.sleep(0.03)
        return found

    monkeypatch.setattr(renders, "active_count", delayed_count)
    monkeypatch.setattr(render_service, "MAX_PENDING_RENDERS", 1)
    context = RenderContext(
        actor=dispatch_env.actor, stream=dispatch_env.stream, timezone="UTC"
    )

    async def submit():
        async with dispatch_env.database.session() as session:
            return await start_render(
                session,
                RenderCreateIn(
                    template_id=dispatch_env.template_id, period="2026-10"
                ),
                context,
            )

    results = await asyncio.gather(submit(), submit(), return_exceptions=True)
    assert sum(isinstance(item, ReportQueueFull) for item in results) == 1
    assert sum(not isinstance(item, BaseException) for item in results) == 1
