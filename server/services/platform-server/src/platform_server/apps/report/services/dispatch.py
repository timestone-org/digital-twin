"""由持久 pending 任务补偿队列投递，短事务认领后在事务外发布。"""

import asyncio
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from pydantic import BaseModel, Field, ValidationError

from lib.logging import get_logger
from lib.stream import StreamLike
from lib.utils.timeutils import format_rfc3339
from platform_server.apps.dataset.services import Sessions
from platform_server.apps.report.crud import renders

STREAM = "platform:report:jobs"
GROUP = "report-workers"
PUBLISH_TIMEOUT_S = 5
DISPATCH_LEASE_S = 30
DISPATCH_TIMEOUT_S = 15
DISPATCH_COOLDOWN_S = 60
MAX_DISPATCH_PER_TICK = 20
MAX_TICK_S = 20
MAX_ATTEMPTS = 64
_logger = get_logger("platform.report.dispatch")


class _DispatchState(BaseModel):
    attempts: int = Field(default=0, ge=0, le=MAX_ATTEMPTS)
    next_attempt_at: str = ""
    token: str = ""
    message_id: str | None = None


@dataclass(frozen=True)
class DispatchAttempt:
    """提交后可执行的一次有租期投递身份。"""

    render_id: uuid.UUID
    token: str
    traceparent: str
    attempts: int
    deadline_s: float


def message_fields(render_id: uuid.UUID, traceparent: str) -> dict[str, str]:
    return {
        "envelope_version": "1",
        "render_id": str(render_id),
        "traceparent": traceparent,
        "idempotency_key": str(render_id),
    }


def initial_payload(now: datetime) -> dict[str, object]:
    state = _DispatchState(
        next_attempt_at=format_rfc3339(
            now + timedelta(seconds=DISPATCH_COOLDOWN_S)
        )
    )
    return {"_dispatch": state.model_dump(mode="json")}


def _prior_attempts(payload: dict[str, object] | None) -> int:
    try:
        return _DispatchState.model_validate(
            (payload or {}).get("_dispatch", {})
        ).attempts
    except ValidationError:
        return 0


def _cooldown(attempts: int, is_delivered: bool) -> int:
    if not is_delivered:
        return DISPATCH_COOLDOWN_S
    return min(3600, 300 * 2 ** min(attempts - 1, 4))


class ReportDispatcher:
    """有界扫描与带数据库栅栏的队列通知补偿。"""

    def __init__(self, database: Sessions, stream: StreamLike) -> None:
        self._database = database
        self._stream = stream
        self._stop = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()

    def stop(self) -> None:
        self._stop.set()

    async def drain(self, timeout_s: float) -> None:
        try:
            async with asyncio.timeout(timeout_s):
                await self._idle.wait()
        except TimeoutError:
            _logger.warning(
                "report_dispatch_drain_timeout", "报告投递未在关停宽限期内完成"
            )

    async def tick(self) -> int:
        """逐条领取并补发，停止后不再领取。"""
        started = time.monotonic()
        self._idle.clear()
        delivered = 0
        try:
            async with asyncio.timeout_at(started + MAX_TICK_S):
                for _ in range(MAX_DISPATCH_PER_TICK):
                    if self._stop.is_set():
                        break
                    attempt = await self._take()
                    if attempt is None or not await self._deliver(attempt):
                        break
                    delivered += 1
        except TimeoutError:
            _logger.warning(
                "report_dispatch_budget_exhausted",
                "报告投递批次超过时限，保留待投递任务",
            )
        finally:
            self._idle.set()
        return delivered

    async def _take(self) -> DispatchAttempt | None:
        async with asyncio.timeout(PUBLISH_TIMEOUT_S):
            async with self._database.session() as session:
                lease_started = time.monotonic()
                now = await renders.dispatch_clock(session)
                pending = await renders.pending_dispatch(session, 1)
                if not pending:
                    return None
                row = pending[0]
                state = _DispatchState(
                    attempts=min(
                        _prior_attempts(row.result_json) + 1, MAX_ATTEMPTS
                    ),
                    token=uuid.uuid4().hex,
                    next_attempt_at=format_rfc3339(
                        now + timedelta(seconds=DISPATCH_LEASE_S)
                    ),
                )
                row.result_json = {"_dispatch": state.model_dump(mode="json")}
                row.updated_at = now
                attempt = DispatchAttempt(
                    row.id,
                    state.token,
                    row.traceparent,
                    state.attempts,
                    lease_started + DISPATCH_LEASE_S,
                )
        return attempt

    async def _deliver(self, attempt: DispatchAttempt) -> bool:
        if time.monotonic() >= attempt.deadline_s:
            return False
        try:
            async with asyncio.timeout_at(
                min(attempt.deadline_s, time.monotonic() + DISPATCH_TIMEOUT_S)
            ):
                async with self._database.session() as session:
                    if not await renders.owns_dispatch(
                        session, attempt.render_id, attempt.token
                    ):
                        return False
                if time.monotonic() >= attempt.deadline_s:
                    return False
                async with asyncio.timeout(PUBLISH_TIMEOUT_S):
                    message_id = await self._stream.publish(
                        STREAM,
                        message_fields(attempt.render_id, attempt.traceparent),
                    )
                await self._save(attempt, message_id)
                return True
        except Exception as error:
            _logger.warning(
                "report_dispatch_failed",
                "报告投递暂未完成，等待补偿",
                render_id=str(attempt.render_id),
                error_type=type(error).__name__,
            )
            async with asyncio.timeout(PUBLISH_TIMEOUT_S):
                await self._save(attempt, None)
            return False

    async def _save(
        self, attempt: DispatchAttempt, message_id: str | None
    ) -> None:
        async with self._database.session() as session:
            now = await renders.dispatch_clock(session)
            state = _DispatchState(
                attempts=attempt.attempts,
                message_id=message_id,
                next_attempt_at=format_rfc3339(
                    now
                    + timedelta(
                        seconds=_cooldown(
                            attempt.attempts, message_id is not None
                        )
                    )
                ),
            )
            await renders.save_dispatch(
                session,
                attempt.render_id,
                attempt.token,
                {"_dispatch": state.model_dump(mode="json")},
            )
