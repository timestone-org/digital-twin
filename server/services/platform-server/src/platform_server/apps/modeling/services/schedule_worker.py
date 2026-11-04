"""worker 中的定时训练认领与待执行消息补偿。"""

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError
from lib.logging import (
    bind_log_context,
    current_traceparent,
    get_logger,
    new_span_id,
    new_trace_id,
    reset_log_context,
)
from lib.stream import StreamGroup, StreamLike
from platform_server.apps.modeling.crud import run_crud
from platform_server.apps.modeling.crud import schedule as schedules
from platform_server.apps.modeling.models.schedule import ModelingSchedule
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.schemas.run import RunOut, RunStartIn
from platform_server.apps.modeling.services import run_queue
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.run_service import (
    RunContext,
    start_run,
)
from platform_server.apps.modeling.services.sessions import Sessions
from platform_server.apps.modeling.services.template_service import record_audit
from platform_server.settings import Settings

_logger = get_logger("platform.modeling.scheduler")
_TICK_S = 60
_BATCH_SIZE = 100


@dataclass(frozen=True)
class ScheduleWorkerOptions:
    sessions: Sessions
    stream: StreamLike
    target: StreamGroup


def following_occurrence(
    due: datetime, now: datetime, interval_minutes: int
) -> datetime:
    """越过错过的周期，保留原始节拍。Args: due, now, interval_minutes。"""
    interval = timedelta(minutes=interval_minutes)
    return due + interval * (max(0, (now - due) // interval) + 1)


class ModelingScheduler:
    """以数据库行锁防重复触发，补偿只恢复尚未认领的训练。"""

    def __init__(self, options: ScheduleWorkerOptions) -> None:
        self._options = options
        self._stop = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()

    @classmethod
    def from_settings(
        cls, sessions: Sessions, stream: StreamLike, settings: Settings
    ) -> "ModelingScheduler":
        return cls(
            ScheduleWorkerOptions(
                sessions,
                stream,
                StreamGroup(
                    stream=settings.modeling_stream,
                    group=settings.modeling_group,
                    consumer=settings.app_instance,
                ),
            )
        )

    def stop(self) -> None:
        self._stop.set()

    async def drain(self, timeout_s: float) -> None:
        try:
            async with asyncio.timeout(timeout_s):
                await self._idle.wait()
        except TimeoutError:
            _logger.warning(
                "modeling_scheduler_drain_timeout",
                "定时训练调度未在宽限期内完成",
            )

    async def run(self) -> None:
        while not self._stop.is_set():
            self._idle.clear()
            try:
                async with asyncio.timeout(30):
                    await self.tick()
            except Exception as error:
                _logger.error(
                    "modeling_scheduler_failed", "定时训练调度失败", error=error
                )
            finally:
                self._idle.set()
            try:
                async with asyncio.timeout(_TICK_S):
                    await self._stop.wait()
            except TimeoutError:
                continue

    async def tick(self, now: datetime | None = None) -> None:
        if now is None:
            async with self._options.sessions.session() as session:
                now = await schedules.clock(session)
        for _ in range(_BATCH_SIZE):
            if self._stop.is_set() or not await self._schedule_one(now):
                break
        for _ in range(_BATCH_SIZE):
            if self._stop.is_set() or not await self._recover_one(now):
                break

    async def _schedule_one(self, now: datetime) -> bool:
        async with self._options.sessions.session() as session:
            row = await schedules.due(session, now)
            if row is None or row.next_run_at is None:
                return False
            due = row.next_run_at
            row.next_run_at = following_occurrence(
                due, now, row.interval_minutes
            )
            row.last_error = None
            if await run_crud.active_of(session, row.pipeline_id) is not None:
                row.last_error = "上一轮训练仍在进行，本次定时训练已跳过"
                return True
            await self._submit(session, row, now)
        return True

    async def _submit(
        self, session: AsyncSession, row: ModelingSchedule, now: datetime
    ) -> None:
        token = bind_log_context(trace_id=new_trace_id(), span_id=new_span_id())
        actor = Actor(row.actor_id, row.actor_name)
        try:
            async with session.begin_nested():
                run = await start_run(
                    session,
                    pipeline_id=row.pipeline_id,
                    payload=RunStartIn(
                        trigger="schedule", auto_publish=row.auto_publish
                    ),
                    context=RunContext(
                        actor=actor,
                        stream=self._options.stream,
                        target=self._options.target,
                        now=now,
                        can_publish=row.auto_publish,
                    ),
                )
            _record_submission(session, row, run, now)
        except AppError as error:
            row.last_error = error.message[:512]
        finally:
            reset_log_context(token)

    async def _recover_one(self, now: datetime) -> bool:
        async with self._options.sessions.session() as session:
            run = await run_crud.pending_dispatch(session, now)
            if run is None:
                return False
            run.dispatch_after = now + timedelta(seconds=_TICK_S)
            traceparent = run.traceparent or current_traceparent()
            run.traceparent = traceparent
            message = run_queue.RunMessage(run.id, traceparent)
            graph = PipelineGraph.model_validate(run.graph_snapshot)
            is_rule = any(
                node.operator == "energy_rules" for node in graph.nodes
            )
            target = (
                run_queue.rules_target(self._options.target)
                if is_rule
                else self._options.target
            )
        try:
            async with asyncio.timeout(5):
                await run_queue.publish_run(
                    self._options.stream, target=target, message=message
                )
        except Exception as error:
            _logger.warning(
                "modeling_schedule_dispatch_failed",
                "定时训练等待队列恢复后重新投递",
                run_id=str(message.run_id),
                error=error,
            )
        return True


def _record_submission(
    session: AsyncSession, row: ModelingSchedule, run: RunOut, now: datetime
) -> None:
    row.last_run_id = run.id
    row.last_run_at = now
    record_audit(
        session,
        Actor(row.actor_id, row.actor_name),
        "training_scheduled",
        row.pipeline_id,
        (
            None,
            {
                "run_id": str(run.id),
                "scheduled_at": now.astimezone(UTC).isoformat(),
            },
        ),
    )
