"""每日增量的两条循环：调度器（只入队）与消费者（真抽取）。

⚠ **两者必须分开，这不是照搬架构模板而是租约的硬约束**：调度器持着单活租约，
而抽取要读几十分钟的外库——锁内禁长 IO（runtime-resilience §7）。调度器自己跑
抽取的话，租约续期会排在那段 IO 后面，过期后第二个副本接任，同一天于是被抽
两遍；而整窗替换让这个错误恰好看不出来，直到某天两个副本的读数不一致。

口径见 docs/AC_PUBLISH_DESIGN.md §6。
"""

import asyncio
import contextlib
from dataclasses import dataclass
from datetime import date, timedelta

from lib.db import Database
from lib.errors import DependencyUnavailable
from lib.logging import bind_log_context, get_logger, reset_log_context
from lib.utils.timeutils import utcnow
from lib.web.middleware import parse_traceparent
from platform_server.apps.hvac.services import ac_daily_queue
from platform_server.apps.hvac.services.ac_startup_daily import (
    DAILY_RUN_APPENDED,
    DailyRun,
    append_day,
    local_today,
    rooms_with_current_batch,
)
from platform_server.apps.hvac.services.ac_startup_extract import (
    ExtractionContext,
)
from platform_server.lease import Lease
from platform_server.stream import StreamEntry, StreamGroup, StreamLike

_logger = get_logger("platform.hvac.ac_daily_worker")


@dataclass(frozen=True)
class SchedulerOptions:
    """调度器的节奏。"""

    target: StreamGroup
    interval_s: float
    timezone: str


class DailyScheduler:
    """跨天就给每个有当前批次的房间投一条日增量任务。**只入队，不干活。**"""

    def __init__(
        self,
        *,
        database: Database,
        stream: StreamLike,
        lease: Lease,
        options: SchedulerOptions,
    ) -> None:
        """按依赖与节奏初始化，构造时不做 IO。

        Args: database, stream, lease, options。
        """
        self._database = database
        self._stream = stream
        self._lease = lease
        self._options = options
        self._stopped = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()
        self._is_leader = False
        self._last_day: date | None = None

    @property
    def is_leader(self) -> bool:
        """此刻是否持有租约。"""
        return self._is_leader

    async def run(self) -> None:
        """常驻循环。一拍出错不许带走它——带走了就再也不会有日增量。"""
        while not self._stopped.is_set():
            self._idle.clear()
            try:
                await self.tick()
            except Exception as error:
                _logger.error(
                    "ac_daily_tick_failed",
                    "日增量调度这一拍出错，下一拍继续",
                    error_type=type(error).__name__,
                )
            finally:
                self._idle.set()
            await self._pause(self._options.interval_s)

    async def tick(self) -> None:
        """跑一拍：续租约 → 看跨天了没有 → 跨了就入队。"""
        if not await self._hold_lease():
            return
        today = local_today(self._options.timezone, now=utcnow())
        if self._last_day == today:
            return
        # ⚠ 第一拍就补一遍昨天，而不是「从下一次跨天算起」：worker 在 00:00
        # 前后重启时，「从下一次算起」会**静默丢掉整整一天**，而重复跑一天
        # 只是白读一遍外库（整窗替换，结果一样）。宁可多跑不可少跑
        yesterday = today - timedelta(days=1)
        self._last_day = today
        await self._enqueue(yesterday)

    def stop(self) -> None:
        """停收新活。⚠ 只置位，不等待——等在 `drain` 里做。"""
        self._stopped.set()

    async def drain(self, timeout_s: float) -> None:
        """等手上这一拍跑完。

        Args: timeout_s。
        """
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._idle.wait(), timeout=timeout_s)

    async def release(self) -> None:
        """让租约。持有才让。"""
        if not self._is_leader:
            return
        self._is_leader = False
        await self._lease.release()
        _logger.info("ac_daily_lease_released", "已让出日增量调度租约")

    async def _enqueue(self, day: date) -> None:
        """给每个有当前批次的房间投一条。

        Args: day。
        """
        async with self._database.session() as session:
            rooms = await rooms_with_current_batch(session)
        if not rooms:
            _logger.info(
                "ac_daily_nothing_to_enqueue",
                "没有任何房间有当前批次，今天不入队",
                business_date=str(day),
            )
            return
        messages = [ac_daily_queue.build(room_id, day) for room_id in rooms]
        await ac_daily_queue.publish_daily(
            self._stream, target=self._options.target, messages=messages
        )
        _logger.info(
            "ac_daily_enqueued",
            "日增量任务已入队",
            business_date=str(day),
            room_count=len(rooms),
        )

    async def _hold_lease(self) -> bool:
        """续或抢租约，返回此刻是不是 leader。

        ⚠ renew-or-die，且 Redis 不可达一律判非 leader：宁可今晚没人抽，
        也不要两个副本同时抽同一天。
        """
        if self._is_leader:
            if await self._lease.renew():
                return True
            self._is_leader = False
            _logger.error("ac_daily_lease_lost", "租约续期失败，停止入队")
            return False
        is_acquired = await self._lease.acquire()
        if is_acquired:
            _logger.info(
                "ac_daily_lease_acquired",
                "接管日增量调度，本副本成为 leader",
            )
        self._is_leader = is_acquired
        return is_acquired

    async def _pause(self, delay_s: float) -> None:
        """等到下一拍，被叫停就提前醒。

        Args: delay_s。
        """
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stopped.wait(), timeout=delay_s)


@dataclass(frozen=True)
class DailyConsumerOptions:
    """消费循环的节奏参数。"""

    target: StreamGroup
    prefetch: int
    block_ms: int
    claim_idle_ms: int
    run_timeout_s: float
    timezone: str


class DailyConsumer:
    """从流里取日增量任务、跑完、确认。

    ⚠ 消费者必须自己幂等：队列是 at-least-once，重复投递是常态。这里的幂等
    靠整窗替换——同一天跑多少遍，库里的结果都一样。
    """

    def __init__(
        self,
        *,
        database: Database,
        stream: StreamLike,
        context: ExtractionContext,
        options: DailyConsumerOptions,
    ) -> None:
        """按依赖与节奏初始化，构造时不做 IO。

        Args: database, stream, context, options。
        """
        self._database = database
        self._stream = stream
        self._context = context
        self._options = options
        self._is_stopping = False
        self._idle = asyncio.Event()
        self._idle.set()

    def stop(self) -> None:
        """不再取新消息。手上这条仍然跑完。"""
        self._is_stopping = True

    async def drain(self, timeout_s: float) -> None:
        """等手上那条跑完；超时就放弃等待（消息没确认，会被别人认领回去）。

        Args: timeout_s。
        """
        try:
            async with asyncio.timeout(timeout_s):
                await self._idle.wait()
        except TimeoutError:
            _logger.warning(
                "ac_daily_drain_timeout",
                "在途的日增量未能在宽限期内跑完，未确认的消息会被重新认领",
            )

    async def run(self) -> None:
        """常驻循环。⚠ 偶发错误记录后继续，否则一次抖动会让循环永久停止。"""
        await self._stream.ensure_group(self._options.target)
        _logger.info(
            "ac_daily_worker_started",
            "日增量消费者已就绪",
            stream=self._options.target.stream,
            group=self._options.target.group,
        )
        while not self._is_stopping:
            await self._tick()

    async def _tick(self) -> None:
        """取一批消息并逐条处理；取不到就是一次空转。"""
        try:
            entries = await self._fetch()
        except DependencyUnavailable as error:
            _logger.warning("ac_daily_fetch_failed", "取消息失败", error=error)
            await asyncio.sleep(self._options.block_ms / 1000)
            return
        for entry in entries:
            if self._is_stopping:
                # 没确认的消息留在待确认表里，由别的消费者认领回去
                return
            await self._handle(entry)

    async def _fetch(self) -> list[StreamEntry]:
        """先认领滞留的，再取新的。

        ⚠ 认领这一步不能省：消费者崩在确认之前的那条消息会永远躺在待确认表里，
        at-least-once 就成了 at-most-once，而那一天会静默地少掉。
        """
        options = self._options
        claimed = await self._stream.claim_stale(
            options.target,
            min_idle_ms=options.claim_idle_ms,
            count=options.prefetch,
        )
        if claimed:
            return claimed
        return await self._stream.read_group(
            options.target, count=options.prefetch, block_ms=options.block_ms
        )

    async def _handle(self, entry: StreamEntry) -> None:
        """处理一条消息：恢复链路 → 抽一天 → 确认。

        Args: entry。
        """
        self._idle.clear()
        message = ac_daily_queue.decode(entry.fields)
        token = bind_log_context(
            trace_id=parse_traceparent(entry.fields.get("traceparent"))
        )
        try:
            if message is None:
                _logger.error(
                    "ac_daily_message_unreadable",
                    "读不懂的队列消息，直接确认丢弃",
                    entry_id=entry.entry_id,
                )
            else:
                await self._process(message)
            # ⚠ 确认只在处理走完之后：放进 finally 的话，宽限期到点被取消的
            # 那一条会被当成跑完了确认掉，而那一天就此静默消失
            await self._stream.ack(self._options.target, entry.entry_id)
        finally:
            reset_log_context(token)
            self._idle.set()

    async def _process(self, message: ac_daily_queue.DailyMessage) -> None:
        """抽一天。失败只记日志——不重试，下一晚会带着更完整的数据再来一次。

        Args: message。
        """
        try:
            async with asyncio.timeout(self._options.run_timeout_s):
                run = await self._run_one(message)
        except Exception as error:
            _logger.error(
                "ac_daily_run_failed",
                "日增量抽取抛出异常，这一天没有补进去",
                room_id=str(message.room_id),
                business_date=str(message.business_date),
                error=error,
            )
            return
        _log_run(message, run)

    async def _run_one(self, message: ac_daily_queue.DailyMessage) -> DailyRun:
        async with self._database.session() as session:
            return await append_day(
                session,
                self._context,
                room_id=message.room_id,
                day=message.business_date,
                timezone=self._options.timezone,
            )


def _log_run(message: ac_daily_queue.DailyMessage, run: DailyRun) -> None:
    """按这一天真实的去向记一条日志。

    ⚠ 「补进去了」与「跳过了」必须是两个 event：混成一条，一个因指纹不符而
    从来没补成功过的房间，在日志里与正常的一模一样。

    Args: message, run。
    """
    common = {
        "room_id": str(message.room_id),
        "business_date": str(message.business_date),
    }
    if run.outcome == DAILY_RUN_APPENDED:
        _logger.info(
            "ac_daily_appended",
            "当天的开机事件已补进当前批次",
            appended=run.appended,
            replaced=run.replaced,
            **common,
        )
        return
    _logger.warning(
        "ac_daily_skipped",
        "这一天没有补进去",
        reason=run.reason,
        **common,
    )
