"""恢复发布 HVAC 任务，并让重复的队列条目共享同一消费凭据。"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.stream import StreamLike
from lib.utils.ids import uuid7
from platform_server.apps.hvac.crud import ac_dispatch
from platform_server.apps.hvac.models import AcDispatch
from platform_server.apps.hvac.services.sessions import Sessions

TRAINING = "training"
SHARD = "shard"
PUBLISH_LEASE_S = 30
PUBLISH_BUDGET_S = 5
POLL_INTERVAL_S = 5
POLL_BUDGET_S = 20
POLL_LIMIT = 20
EXECUTION_GRACE_S = 30

_logger = get_logger("platform.hvac.dispatch")


def stage_dispatch(
    session: AsyncSession,
    dispatch_id: uuid.UUID,
    kind: str,
    fields: dict[str, str],
) -> None:
    """与业务行同事务保存完整消息。Args: session, dispatch_id, kind, fields。"""
    session.add(AcDispatch(id=dispatch_id, kind=kind, fields=fields))


async def _publish_one(
    database: Sessions,
    stream: StreamLike,
    targets: Mapping[str, str],
    requested: tuple[uuid.UUID, ...] | None,
) -> bool:
    """短事务认领、事务外发布。Args: database, stream, targets, requested。"""
    async with asyncio.timeout(PUBLISH_BUDGET_S):
        async with database.session() as session:
            attempt = await ac_dispatch.claim_dispatch(
                session, targets.keys(), requested, PUBLISH_LEASE_S
            )
        if attempt is None:
            return False
        async with database.session() as session:
            if not await ac_dispatch.is_current(session, attempt):
                return False
        if not attempt.fields.get("traceparent"):
            raise ValueError("HVAC 投递信封缺少 traceparent")
        await stream.publish(targets[attempt.kind], attempt.fields)
        async with database.session() as session:
            await ac_dispatch.mark_published(session, attempt)
        return True


async def publish_waiting(
    database: Sessions,
    stream: StreamLike,
    targets: Mapping[str, str],
    requested: tuple[uuid.UUID, ...] | None = None,
    should_stop: Callable[[], bool] = lambda: False,
) -> int:
    """发布一批持久信封。

    Args: database, stream, targets, requested, should_stop。
    """
    count = 0
    try:
        async with asyncio.timeout(POLL_BUDGET_S):
            for _ in range(POLL_LIMIT):
                if should_stop():
                    break
                if not await _publish_one(database, stream, targets, requested):
                    break
                count += 1
    except Exception as error:
        _logger.warning(
            "ac_dispatch_pending", "任务仍待投递，将在租约期后接力", error=error
        )
    return count


class AcDispatchWorker:
    """定期投递已落库的 HVAC 任务，使用与正常后台投递相同的租约。"""

    def __init__(
        self, database: Sessions, stream: StreamLike, targets: Mapping[str, str]
    ) -> None:
        self.database = database
        self.stream = stream
        self.targets = targets
        self._stop = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()

    async def run(self) -> None:
        """执行有界投递，等待下一轮或停止。"""
        while not self._stop.is_set():
            self._idle.clear()
            try:
                await publish_waiting(
                    self.database,
                    self.stream,
                    self.targets,
                    should_stop=self._stop.is_set,
                )
                await self._prune()
            finally:
                self._idle.set()
            try:
                async with asyncio.timeout(POLL_INTERVAL_S):
                    await self._stop.wait()
            except TimeoutError:
                continue

    async def _prune(self) -> None:
        try:
            async with (
                asyncio.timeout(PUBLISH_BUDGET_S),
                self.database.session() as session,
            ):
                await ac_dispatch.prune_completed(session)
        except Exception as error:
            _logger.warning(
                "ac_dispatch_prune_failed", "暂未清理已处理的任务", error=error
            )

    def stop(self) -> None:
        """停止领取新的投递。"""
        self._stop.set()

    async def drain(self, timeout_s: float) -> None:
        """等待正在投递的批次。Args: timeout_s。"""
        try:
            async with asyncio.timeout(timeout_s):
                await self._idle.wait()
        except TimeoutError:
            _logger.warning(
                "ac_dispatch_drain_timeout", "任务投递将在租约期后接力"
            )


@dataclass(frozen=True)
class ConsumerDelivery:
    """Redis 条目及其持久任务身份。"""

    dispatch_id: uuid.UUID | None
    entry_id: str
    fields: Mapping[str, str]
    kind: str
    timeout_s: float


async def process_delivery(
    database: Sessions,
    delivery: ConsumerDelivery,
    can_run: Callable[[AsyncSession], Awaitable[bool]],
    action: Callable[[], Awaitable[None]],
) -> bool:
    """认领消息并处理，返回是否可确认队列条目。

    Args: database, delivery, can_run, action。
    """
    if delivery.dispatch_id is None:
        await action()
        return True
    async with database.session() as session:
        token, should_ack = await _claim_execution(
            session, delivery.dispatch_id, delivery, can_run
        )
    if token is None:
        return should_ack
    await action()
    async with database.session() as session:
        return await ac_dispatch.complete(session, delivery.dispatch_id, token)


async def _claim_execution(
    session: AsyncSession,
    dispatch_id: uuid.UUID,
    delivery: ConsumerDelivery,
    can_run: Callable[[AsyncSession], Awaitable[bool]],
) -> tuple[uuid.UUID | None, bool]:
    """不同流条目的同一任务只接收一个。

    Args: session, dispatch_id, delivery, can_run。
    """
    row = await ac_dispatch.lock_dispatch(session, dispatch_id)
    if row is None or row.completed_at is not None:
        return None, True
    if row.kind != delivery.kind or row.fields != delivery.fields:
        return None, True
    if row.entry_id is not None and row.entry_id != delivery.entry_id:
        return None, True
    now = await ac_dispatch.database_now(session)
    if row.execution_until is not None and row.execution_until > now:
        return None, False
    if not await can_run(session):
        row.completed_at = now
        return None, True
    token = uuid7()
    row.entry_id = delivery.entry_id
    row.execution_token = token
    row.execution_until = now + timedelta(
        seconds=delivery.timeout_s + EXECUTION_GRACE_S
    )
    return token, False
