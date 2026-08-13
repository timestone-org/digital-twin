"""训练任务的消费循环，与分片消费并行跑在同一个 worker 进程里。

循环骨架与 `ac_startup_worker.py` 同构（取 → 认领 → 处理 → 确认，确认只在
处理走完之后）；差异只在消息形状与处理体。⚠ 消费者必须自己幂等：队列是
at-least-once（docs/agents/runtime-resilience.md §5）。
"""

import asyncio
from collections.abc import Callable
from concurrent.futures import Executor, ProcessPoolExecutor
from dataclasses import dataclass

from lib.db import Database
from lib.errors import DependencyUnavailable
from lib.logging import bind_log_context, get_logger, reset_log_context
from lib.web.middleware import parse_traceparent
from platform_server.apps.hvac.services import ac_model_queue
from platform_server.apps.hvac.services.ac_model_trainer import (
    TRAIN_RUN_FAILED,
    TRAIN_RUN_ORPHANED,
    TRAIN_RUN_TRAINED,
    TrainRun,
    mark_failed,
    run_training,
)
from platform_server.stream import StreamEntry, StreamGroup, StreamLike

_logger = get_logger("platform.hvac.ac_model_worker")


class TrainerPool:
    """训练用的进程池，超时后整池换新。

    ⚠ `ProcessPoolExecutor` 没有公开的「杀掉在跑任务」的口：cancel 只对还没
    开跑的生效，`shutdown(cancel_futures=True)` 也一样。超时被掐断的拟合会
    继续在子进程里烧 CPU，而单工池的下一个任务要排在它后面——僵尸拟合等于
    把训练面整个堵死。唯一的出路是杀进程、换新池；`_processes` 是私有面，
    sklearn 拟合无副作用，杀了没有半成品要收拾。
    """

    def __init__(self, factory: Callable[[], Executor] | None = None) -> None:
        self._factory = factory or (lambda: ProcessPoolExecutor(max_workers=1))
        self._executor = self._factory()

    @property
    def executor(self) -> Executor:
        """当前可用的执行器。"""
        return self._executor

    def recycle(self) -> None:
        """杀掉旧池里的子进程并换新池。超时路径专用。"""
        old = self._executor
        self._executor = self._factory()
        self._terminate(old)

    def shutdown(self) -> None:
        """进程收摊时释放当前池。"""
        self._terminate(self._executor)

    @staticmethod
    def _terminate(executor: Executor) -> None:
        for process in getattr(executor, "_processes", {}).values():
            process.kill()
        executor.shutdown(wait=False, cancel_futures=True)


@dataclass(frozen=True)
class TrainerOptions:
    """消费循环的节奏参数。"""

    target: StreamGroup
    prefetch: int
    block_ms: int
    claim_idle_ms: int
    train_timeout_s: float
    timezone: str


class TrainingConsumer:
    """从流里取训练任务、训完、确认。

    ⚠ 关停顺序是「停止取新消息 → 跑完手上这条 → 退出」，绝不能跑到一半就退
    且已经确认（docs/agents/runtime-resilience.md §8）。
    """

    def __init__(
        self,
        *,
        database: Database,
        stream: StreamLike,
        pool: TrainerPool,
        options: TrainerOptions,
    ) -> None:
        self._database = database
        self._stream = stream
        self._pool = pool
        self._options = options
        self._is_stopping = False
        self._idle = asyncio.Event()
        self._idle.set()

    def stop(self) -> None:
        """不再取新消息。手上这条仍然跑完。"""
        self._is_stopping = True

    async def drain(self, timeout_s: float) -> None:
        """等手上那条跑完，超时就放弃等待（消息没确认，会被别人认领回去）。

        Args: timeout_s。
        """
        try:
            async with asyncio.timeout(timeout_s):
                await self._idle.wait()
        except TimeoutError:
            _logger.warning(
                "ac_model_worker_drain_timeout",
                "在途训练未能在宽限期内跑完，未确认的消息会被重新认领",
            )

    async def run(self) -> None:
        """常驻循环。⚠ 偶发错误记录后继续，否则一次抖动会让循环永久停止。"""
        await self._stream.ensure_group(self._options.target)
        _logger.info(
            "ac_model_worker_started",
            "训练消费者已就绪",
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
            _logger.warning(
                "ac_model_worker_fetch_failed", "取消息失败", error=error
            )
            await asyncio.sleep(self._options.block_ms / 1000)
            return
        for entry in entries:
            if self._is_stopping:
                # 没确认的消息留在待确认表里，由别的消费者认领回去
                return
            await self._handle(entry)

    async def _fetch(self) -> list[StreamEntry]:
        """先认领滞留的，再取新的（at-least-once 不能靠运气）。"""
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
        """处理一条消息：恢复链路 → 训练 → 确认。

        Args: entry。
        """
        self._idle.clear()
        message = ac_model_queue.decode(entry.fields)
        token = bind_log_context(
            trace_id=parse_traceparent(entry.fields.get("traceparent"))
        )
        try:
            if message is None:
                _logger.error(
                    "ac_model_message_unreadable",
                    "读不懂的队列消息，直接确认丢弃",
                    entry_id=entry.entry_id,
                )
            else:
                await self._process(message)
            # ⚠ 确认只在处理走完之后：放进 finally 会把宽限期到点被取消的那条
            # 当成跑完了确认掉，而 drain 的约定恰恰是「没确认，会被认领回去」
            await self._stream.ack(self._options.target, entry.entry_id)
        finally:
            reset_log_context(token)
            self._idle.set()

    async def _process(self, message: ac_model_queue.TrainMessage) -> None:
        """训一个模型；超时或异常都要把失败落到模型行上。

        ⚠ 训练超时按不可重试处理（写操作）：标记失败等人重新点，而不是让
        重放把 worker 拖进「永远在训同一个超时模型」的循环。
        Args: message。
        """
        try:
            async with asyncio.timeout(self._options.train_timeout_s):
                run = await run_training(
                    self._database,
                    executor=self._pool.executor,
                    timezone=self._options.timezone,
                    model_id=message.model_id,
                )
        except TimeoutError:
            # ⚠ 掐断的只是等待，拟合还在子进程里烧：必须杀进程换池，
            # 否则单工池被僵尸拟合占着，下一次训练永远排不上
            self._pool.recycle()
            reason = f"训练超过 {self._options.train_timeout_s:.0f} 秒被掐断"
            await self._record_failure(message, reason=reason)
            return
        except Exception as error:
            _logger.error(
                "ac_model_train_error",
                "训练抛出异常",
                model_id=str(message.model_id),
                error=error,
            )
            await self._record_failure(message, reason=str(error))
            return
        self._log_run(message, run)

    @staticmethod
    def _log_run(message: ac_model_queue.TrainMessage, run: TrainRun) -> None:
        """按这一次训练真实的去向记一条日志。

        ⚠ 训完/拒训/孤儿必须是三个 event：混成一条，卡住的模型在日志里
        与训通的一模一样（同 ac_startup_worker 的教训）。
        Args: message, run。
        """
        if run.outcome == TRAIN_RUN_TRAINED:
            _logger.info(
                "ac_model_train_done",
                "训练完成",
                model_id=str(message.model_id),
            )
        elif run.outcome == TRAIN_RUN_FAILED:
            _logger.warning(
                "ac_model_train_rejected",
                "训练失败已落库",
                model_id=str(message.model_id),
                reason=run.reason,
            )
        elif run.outcome == TRAIN_RUN_ORPHANED:
            _logger.warning(
                "ac_model_train_orphaned",
                "模型已不存在，消息丢弃",
                model_id=str(message.model_id),
                reason=run.reason,
            )

    async def _record_failure(
        self, message: ac_model_queue.TrainMessage, *, reason: str
    ) -> None:
        try:
            await mark_failed(self._database, message.model_id, reason=reason)
        # 连失败都记不下来时只剩日志，但循环必须活着
        except Exception as error:  # pragma: no cover - 依赖库同时不可用
            _logger.error(
                "ac_model_failure_unrecorded",
                "训练失败状态未能落库",
                error=error,
            )
