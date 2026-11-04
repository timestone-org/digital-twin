"""定时规则、真实数据库认领与队列恢复契约。"""

import asyncio
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from conftest import AppContext, SignHeaders
from sqlalchemy import func, select
from unit.source_fakes import InMemoryStream

from integration.modeling_helpers import (
    PIPELINES,
    create_pipeline,
    data_of,
    linear_graph,
)
from lib.auth import CallerContext
from lib.db import Database
from lib.errors import DependencyUnavailable
from lib.stream import StreamGroup
from platform_server.apps.modeling.models import ModelingPipeline, ModelingRun
from platform_server.apps.modeling.schemas.pipeline import PipelineCreateIn
from platform_server.apps.modeling.schemas.run import RunStartIn
from platform_server.apps.modeling.schemas.schedule import ModelingScheduleIn
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.pipeline_service import (
    create_pipeline as create_stored_pipeline,
)
from platform_server.apps.modeling.services.run_service import (
    RunContext,
    cancel_run,
    start_run,
)
from platform_server.apps.modeling.services.schedule_service import (
    save_schedule,
)
from platform_server.apps.modeling.services.schedule_worker import (
    ModelingScheduler,
    ScheduleWorkerOptions,
)
from platform_server.settings import Settings


class RecoverableStream(InMemoryStream):
    is_unavailable: bool = False
    attempted_traceparent: str | None = None

    async def publish(self, stream: str, fields: Mapping[str, str]) -> str:
        self.attempted_traceparent = fields.get("traceparent")
        if self.is_unavailable:
            raise DependencyUnavailable("queue unavailable")
        return await super().publish(stream, fields)


async def enable(
    client: httpx.AsyncClient, code: str = "scheduled"
) -> tuple[str, datetime]:
    pipeline = await create_pipeline(client, code, linear_graph("energy-data"))
    now = datetime.now(UTC)
    response = await client.put(
        f"{PIPELINES}/{pipeline['id']}/schedule",
        json={
            "is_enabled": True,
            "interval_minutes": 5,
            "auto_publish": False,
            "first_run_at": (now + timedelta(minutes=1)).isoformat(),
            "expected_revision": 0,
        },
    )
    assert response.status_code == 200, response.text
    return str(pipeline["id"]), now + timedelta(minutes=1)


def scheduler(context: AppContext, stream: InMemoryStream) -> ModelingScheduler:
    return ModelingScheduler(
        ScheduleWorkerOptions(
            context.sessions,
            stream,
            StreamGroup(
                stream="test-runs", group="test-runners", consumer="scheduler"
            ),
        )
    )


async def test_schedule_defaults_revision_timezone_and_permissions(
    app_client, sign: SignHeaders
):
    pipeline = await create_pipeline(
        app_client, "schedule-config", linear_graph("energy-data")
    )
    url = f"{PIPELINES}/{pipeline['id']}/schedule"
    assert data_of(await app_client.get(url))["revision"] == 0
    payload = {
        "is_enabled": True,
        "interval_minutes": 60,
        "auto_publish": True,
        "first_run_at": "2030-01-01T08:00:00+08:00",
        "expected_revision": 0,
    }
    denied = await app_client.put(
        url, json=payload, headers=sign(("modeling:view", "modeling:run"))
    )
    assert denied.status_code == 403
    response = await app_client.put(url, json=payload)
    assert response.status_code == 200, response.text
    assert data_of(response)["next_run_at"] == "2030-01-01T00:00:00.000Z"
    payload["interval_minutes"] = 120
    assert (await app_client.put(url, json=payload)).status_code == 409
    assert data_of(await app_client.get(url))["interval_minutes"] == 60
    assert (await app_client.get(url, headers=sign(()))).status_code == 403
    assert (
        await app_client.put(
            url, json=payload, headers=sign(("modeling:view",))
        )
    ).status_code == 403


async def test_same_tick_creates_one_run_and_keeps_actor_and_trace(
    app_context: AppContext,
):
    identity, due = await enable(app_context.client)
    stream = InMemoryStream()
    worker = scheduler(app_context, stream)
    await worker.tick()
    assert stream.entries == []
    await worker.tick(due)
    await worker.tick(due)
    rule = data_of(
        await app_context.client.get(f"{PIPELINES}/{identity}/schedule")
    )
    assert rule["last_run_id"] is not None
    assert rule["last_error"] is None
    assert len(stream.entries) == 1
    assert stream.entries[0].fields["traceparent"]
    await worker.tick(due + timedelta(seconds=61))
    assert (
        stream.entries[0].fields["traceparent"]
        == stream.entries[1].fields["traceparent"]
    )
    async with app_context.sessions.session() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(ModelingRun)
            .where(ModelingRun.pipeline_id == uuid.UUID(identity))
        )
        run = await session.get(ModelingRun, uuid.UUID(rule["last_run_id"]))
        assert count == 1
        assert run is not None
        assert run.trigger == "schedule"
        assert run.created_by_name == "测试员"


async def test_inflight_skips_missed_periods_and_disable_stops_future_runs(
    app_context: AppContext,
):
    identity, due = await enable(app_context.client)
    stream = InMemoryStream()
    worker = scheduler(app_context, stream)
    await worker.tick(due)
    await worker.tick(due + timedelta(days=4))
    url = f"{PIPELINES}/{identity}/schedule"
    rule = data_of(await app_context.client.get(url))
    assert "跳过" in rule["last_error"]
    next_at = datetime.fromisoformat(rule["next_run_at"].replace("Z", "+00:00"))
    assert next_at > due + timedelta(days=4)
    response = await app_context.client.put(
        url,
        json={
            "is_enabled": False,
            "interval_minutes": 5,
            "expected_revision": rule["revision"],
        },
    )
    assert response.status_code == 200
    await worker.tick(due + timedelta(days=10))
    assert data_of(await app_context.client.get(url))["next_run_at"] is None


async def test_queue_failure_keeps_pending_identity_for_later_dispatch(
    app_context: AppContext,
):
    identity, due = await enable(app_context.client)
    stream = RecoverableStream()
    stream.is_unavailable = True
    worker = scheduler(app_context, stream)
    await worker.tick(due)
    first = data_of(
        await app_context.client.get(f"{PIPELINES}/{identity}/schedule")
    )
    assert first["last_run_id"] is not None
    assert stream.entries == []
    await worker.tick(due + timedelta(seconds=61))
    assert stream.entries == []
    stream.is_unavailable = False
    await worker.tick(due + timedelta(seconds=122))
    assert len(stream.entries) == 1
    assert stream.entries[0].fields["run_id"] == first["last_run_id"]


@pytest.mark.parametrize("should_cancel", [False, True])
async def test_manual_training_queue_failure_is_recovered_with_original_trace(
    app_context: AppContext,
    should_cancel: bool,
):
    pipeline = await create_pipeline(
        app_context.client, "manual-recovery", linear_graph("energy-data")
    )
    stream = RecoverableStream()
    stream.is_unavailable = True
    now = datetime.now(UTC)
    async with app_context.sessions.session() as session:
        run = await start_run(
            session,
            pipeline_id=uuid.UUID(pipeline["id"]),
            payload=RunStartIn(),
            context=RunContext(
                Actor("manual-owner", "手动训练用户"),
                stream,
                StreamGroup(
                    stream="test-runs", group="test-runners", consumer="manual"
                ),
                now,
            ),
        )
    original_trace = stream.attempted_traceparent
    assert original_trace
    if should_cancel:
        async with app_context.sessions.session() as session:
            await cancel_run(session, run.id)
    stream.is_unavailable = False
    await scheduler(app_context, stream).tick(now + timedelta(seconds=61))
    assert len(stream.entries) == 1
    assert stream.entries[0].fields["run_id"] == str(run.id)
    assert stream.entries[0].fields["traceparent"] == original_trace


async def test_deleted_workflow_removes_schedule_before_trigger(
    app_context: AppContext,
):
    identity, due = await enable(app_context.client)
    response = await app_context.client.delete(f"{PIPELINES}/{identity}")
    assert response.status_code == 204
    stream = InMemoryStream()
    await scheduler(app_context, stream).tick(due)
    assert stream.entries == []


async def test_successful_training_exposes_failed_automatic_publication(
    app_context: AppContext,
):
    identity, due = await enable(app_context.client)
    await scheduler(app_context, InMemoryStream()).tick(due)
    url = f"{PIPELINES}/{identity}/schedule"
    rule = data_of(await app_context.client.get(url))
    async with app_context.sessions.session() as session:
        run = await session.get(ModelingRun, uuid.UUID(rule["last_run_id"]))
        assert run is not None
        run.status = "succeeded"
        run.publication_status = "failed"
        run.publication_error = "模型输入输出签名已改变，请核对并显式确认"
    result = data_of(await app_context.client.get(url))
    assert result["last_error"] == "模型输入输出签名已改变，请核对并显式确认"


async def test_invalid_graph_is_visible_and_advances_schedule(
    app_context: AppContext,
):
    graph = linear_graph("energy-data")
    graph["edges"][0]["from_node"] = "missing"
    pipeline = await create_pipeline(
        app_context.client, "invalid-scheduled", graph
    )
    url = f"{PIPELINES}/{pipeline['id']}/schedule"
    response = await app_context.client.put(
        url,
        json={
            "is_enabled": True,
            "interval_minutes": 5,
            "expected_revision": 0,
        },
    )
    assert response.status_code == 200
    due = datetime.fromisoformat(
        data_of(response)["next_run_at"].replace("Z", "+00:00")
    )
    await scheduler(app_context, InMemoryStream()).tick(
        due + timedelta(seconds=1)
    )
    rule = data_of(await app_context.client.get(url))
    assert rule["last_error"]
    assert rule["last_run_id"] is None


async def test_two_worker_replicas_claim_one_occurrence(settings: Settings):
    database = Database(dsn=settings.dsn(), search_path="platform")
    identity = uuid.uuid4()
    caller = CallerContext(
        identity, "scheduler-owner", "admin", frozenset({"modeling:run"})
    )
    pipeline_id = None
    due = datetime.now(UTC) + timedelta(minutes=1)
    try:
        pipeline_id = await _seed_concurrent(database, caller, due)
        stream = InMemoryStream()
        options = ScheduleWorkerOptions(
            database,
            stream,
            StreamGroup(stream="test", group="test", consumer="one"),
        )
        await asyncio.gather(
            ModelingScheduler(options).tick(due),
            ModelingScheduler(options).tick(due),
        )
        async with database.session() as session:
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(ModelingRun)
                    .where(ModelingRun.pipeline_id == pipeline_id)
                )
                == 1
            )
        assert len(stream.entries) == 1
    finally:
        if pipeline_id is not None:
            async with database.session() as session:
                pipeline = await session.get(ModelingPipeline, pipeline_id)
                if pipeline is not None:
                    await session.delete(pipeline)
        await database.dispose()


async def _seed_concurrent(
    database: Database, caller: CallerContext, due: datetime
) -> uuid.UUID:
    async with database.session() as session:
        created = await create_stored_pipeline(
            session,
            payload=PipelineCreateIn.model_validate(
                {
                    "code": f"schedule-concurrent-{caller.user_id.hex[:8]}",
                    "name": "并发调度",
                    "graph": linear_graph("energy-data"),
                }
            ),
            actor=Actor(str(caller.user_id), caller.username),
        )
        await save_schedule(
            session,
            created.id,
            ModelingScheduleIn(
                is_enabled=True,
                interval_minutes=5,
                first_run_at=due,
                expected_revision=0,
            ),
            caller,
        )
        return created.id
