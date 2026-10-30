"""报告待投递记录的读取兼容、超时与有界恢复。"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.report.test_api_worker import Sessions

from lib.auth import CallerContext
from lib.db import run_after_commit_hooks
from lib.errors import DependencyUnavailable
from platform_server.apps.report.models import ReportRender
from platform_server.apps.report.services import dispatch, render_service
from platform_server.apps.report.services.dispatch import ReportDispatcher
from platform_server.apps.report.services.worker import (
    ReportWorker,
    WorkerOptions,
)

TRACE = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"


def pending_row():
    return ReportRender(
        id=uuid.uuid4(),
        template_id=None,
        schedule_id=None,
        period="2026-10",
        granularity="month",
        timezone="UTC",
        kind="render",
        status="pending",
        warnings_json=[],
        error=None,
        created_at=datetime.now(UTC),
        started_at=None,
        finished_at=None,
        created_by="author",
        traceparent=TRACE,
        snapshot_json={},
        result_json={"_dispatch": {"attempts": 1}},
    )


async def test_pending_dispatch_metadata_is_not_parsed_as_a_preview(
    monkeypatch,
):
    row = pending_row()
    monkeypatch.setattr(
        render_service, "require_render", AsyncMock(return_value=row)
    )
    caller = CallerContext(
        uuid.uuid4(), "reader", "admin", frozenset({"report:render"})
    )
    async with AsyncSession() as session:
        result = await render_service.read_render(session, row.id, caller)
    assert result.status == "pending"
    assert result.preview is None


async def test_initial_publish_has_a_hard_timeout(monkeypatch):
    monkeypatch.setattr(
        render_service, "PUBLISH_TIMEOUT_S", 0.01, raising=False
    )

    async def blocked(*_arguments):
        await asyncio.Event().wait()

    stream = SimpleNamespace(publish=AsyncMock(side_effect=blocked))
    async with AsyncSession() as session:
        render_service.enqueue(session, pending_row(), stream)
        await asyncio.wait_for(run_after_commit_hooks(session), timeout=0.2)
    stream.publish.assert_awaited_once()


def dispatcher_fakes(monkeypatch, *, publish=None):
    row = pending_row()
    pending = AsyncMock(side_effect=[[row], []])
    monkeypatch.setattr(
        dispatch.renders,
        "dispatch_clock",
        AsyncMock(side_effect=lambda *_arguments: datetime.now(UTC)),
    )
    monkeypatch.setattr(dispatch.renders, "pending_dispatch", pending)
    monkeypatch.setattr(
        dispatch.renders, "owns_dispatch", AsyncMock(return_value=True)
    )
    saved = AsyncMock(return_value=True)
    monkeypatch.setattr(dispatch.renders, "save_dispatch", saved)
    stream = SimpleNamespace(publish=publish or AsyncMock(return_value="1-0"))
    return ReportDispatcher(Sessions(), stream), row, stream, pending, saved


async def test_recovery_publishes_outside_transactions_and_keeps_original_trace(
    monkeypatch,
):
    consumer, row, stream, _pending, saved = dispatcher_fakes(monkeypatch)
    now = datetime.now(UTC)
    assert await consumer.tick() == 1
    fields = stream.publish.await_args.args[1]
    assert fields["render_id"] == str(row.id)
    assert fields["traceparent"] == TRACE
    assert saved.await_args.args[2] == row.result_json["_dispatch"]["token"]
    state = saved.await_args.args[3]["_dispatch"]
    assert state["token"] == ""
    assert state["message_id"] == "1-0"
    assert datetime.fromisoformat(
        state["next_attempt_at"].replace("Z", "+00:00")
    ) >= now + timedelta(seconds=299)


async def test_failed_dispatch_has_cooldown_without_immediate_retry(
    monkeypatch,
):
    consumer, _row, stream, pending, saved = dispatcher_fakes(
        monkeypatch,
        publish=AsyncMock(side_effect=DependencyUnavailable("Redis不可用")),
    )
    now = datetime.now(UTC)
    assert await consumer.tick() == 0
    stream.publish.assert_awaited_once()
    pending.assert_awaited_once()
    state = saved.await_args.args[3]["_dispatch"]
    assert state["message_id"] is None
    assert datetime.fromisoformat(
        state["next_attempt_at"].replace("Z", "+00:00")
    ) >= now + timedelta(seconds=59)


async def test_expired_or_superseded_dispatch_token_cannot_publish(monkeypatch):
    consumer, _row, stream, _pending, saved = dispatcher_fakes(monkeypatch)
    monkeypatch.setattr(
        dispatch.renders, "owns_dispatch", AsyncMock(return_value=False)
    )
    assert await consumer.tick() == 0
    stream.publish.assert_not_awaited()
    saved.assert_not_awaited()


async def test_dispatch_stop_does_not_claim_more_work(monkeypatch):
    consumer, _row, stream, pending, _saved = dispatcher_fakes(monkeypatch)

    async def publish(*_arguments):
        consumer.stop()
        return "1-0"

    stream.publish.side_effect = publish
    assert await consumer.tick() == 1
    await consumer.drain(0.1)
    pending.assert_awaited_once()


async def test_dispatch_tick_is_bounded_to_single_row_claims(monkeypatch):
    consumer, _row, stream, pending, _saved = dispatcher_fakes(monkeypatch)
    pending.side_effect = lambda *_arguments: [pending_row()]
    assert await consumer.tick() == dispatch.MAX_DISPATCH_PER_TICK
    assert stream.publish.await_count == dispatch.MAX_DISPATCH_PER_TICK
    assert all(call.args[1] == 1 for call in pending.await_args_list)


async def test_worker_recovers_when_group_creation_initially_fails(monkeypatch):
    stream = SimpleNamespace(ensure_group=AsyncMock())
    consumer = ReportWorker(
        WorkerOptions(
            database=Sessions(),
            stream=stream,
            store=SimpleNamespace(),
            consumer="test",
        ),
        SimpleNamespace(),
    )
    attempts = 0

    async def ensure(_target):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            consumer._wake.set()
            raise DependencyUnavailable("Redis不可用")

    async def tick(_target):
        consumer.stop()

    stream.ensure_group.side_effect = ensure
    monkeypatch.setattr(consumer, "_tick", tick)
    await asyncio.wait_for(consumer.run(), timeout=0.2)
    assert attempts == 2


async def test_tick_budget_cancels_a_slow_claim(monkeypatch):
    consumer, _row, stream, _pending, _saved = dispatcher_fakes(monkeypatch)
    monkeypatch.setattr(dispatch, "MAX_TICK_S", 0.01)

    async def blocked():
        await asyncio.Event().wait()

    monkeypatch.setattr(consumer, "_take", blocked)
    assert await asyncio.wait_for(consumer.tick(), timeout=0.1) == 0
    stream.publish.assert_not_awaited()


async def test_tick_budget_cancels_slow_delivery_and_keeps_lease(monkeypatch):
    consumer, row, _stream, _pending, saved = dispatcher_fakes(monkeypatch)
    monkeypatch.setattr(dispatch, "MAX_TICK_S", 0.01)

    async def blocked(_attempt):
        await asyncio.Event().wait()

    monkeypatch.setattr(consumer, "_deliver", blocked)
    assert await asyncio.wait_for(consumer.tick(), timeout=0.1) == 0
    assert row.result_json["_dispatch"]["token"]
    saved.assert_not_awaited()


async def test_pause_after_claim_cannot_publish_with_elapsed_lease(monkeypatch):
    consumer, _row, stream, _pending, saved = dispatcher_fakes(monkeypatch)
    monkeypatch.setattr(dispatch, "DISPATCH_LEASE_S", 0.01)
    attempt = await consumer._take()
    assert attempt is not None
    await asyncio.sleep(0.02)
    assert not await consumer._deliver(attempt)
    stream.publish.assert_not_awaited()
    saved.assert_not_awaited()


@pytest.mark.parametrize("phase", ["group", "read"])
async def test_unknown_queue_error_exits_instead_of_polling(monkeypatch, phase):
    stream = SimpleNamespace(ensure_group=AsyncMock())
    consumer = ReportWorker(
        WorkerOptions(
            database=Sessions(),
            stream=stream,
            store=SimpleNamespace(),
            consumer="test",
        ),
        SimpleNamespace(),
    )
    unexpected = RuntimeError("unexpected queue implementation error")
    if phase == "group":
        stream.ensure_group.side_effect = unexpected
    tick = AsyncMock(side_effect=unexpected)
    monkeypatch.setattr(consumer, "_tick", tick)
    with pytest.raises(
        RuntimeError, match="unexpected queue implementation error"
    ):
        async with asyncio.timeout(0.2):
            await consumer.run()
    stream.ensure_group.assert_awaited_once()
    assert tick.await_count == (1 if phase == "read" else 0)
