"""运行任务的消费循环，与其它几条并行跑在同一个 worker 进程里。

循环骨架与 `ac_model_worker.py` 同构（取 → 认领 → 处理 → 确认，确认只在处理
走完之后）；差异只在消息形状与处理体。⚠ 消费者必须自己幂等：队列是
at-least-once（docs/agents/runtime-resilience.md §5）。
"""

import asyncio
from dataclasses import dataclass

from lib.errors import DependencyUnavailable
from lib.logging import (
    bind_log_context,
    get_logger,
    parse_traceparent,
    reset_log_context,
)
from lib.objectstore import ObjectStore
from lib.stream import StreamEntry, StreamGroup, StreamLike
from platform_server.apps.modeling.services import run_queue
from platform_server.apps.modeling.services.run_dispatch import (
    RUN_DONE,
    RUN_INTERRUPTED,
    RUN_ORPHANED,
    DispatchOptions,
    execute_run,
)
from platform_server.apps.modeling.services.run_pool import (
    NodePool,
    PooledRunner,
)
from platform_server.apps.modeling.services.sessions import Sessions

_logger = get_logger("platform.modeling.worker")


@dataclass(frozen=True)
class RunConsumerOptions:
    """消费循环的节奏参数。"""

    target: StreamGroup
    prefetch: int
    block_ms: int
    claim_idle_ms: int
    node_timeout_s: float
    tz_offset_minutes: int
    #: 二进制产物的落脚处。缺省「没有」——纯 JSON 那些算子一个字节都不产
    store: ObjectStore | None = None


class RunConsumer:
    """从流里取运行任务、跑完、确认。

    ⚠ 关停顺序是「停止取新消息 → 跑完手上这条 → 退出」，绝不能跑到一半就退
    且已经确认（docs/agents/runtime-resilience.md §8）。
    """

    def __init__(
        self,
        *,
        sessions: Sessions,
        stream: StreamLike,
        pool: NodePool,
        options: RunConsumerOptions,
    ) -> None:
        self._sessions = sessions
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
                "modeling_worker_drain_timeout",
                "在途运行未能在宽限期内跑完，未确认的消息会被重新认领",
            )

    async def run(self) -> None:
        """常驻循环。⚠ 偶发错误记录后继续，否则一次抖动会让循环永久停止。"""
        await self._stream.ensure_group(self._options.target)
        _logger.info(
            "modeling_worker_started",
            "建模运行消费者已就绪",
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
                "modeling_worker_fetch_failed", "取消息失败", error=error
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
        """处理一条消息：恢复链路 → 跑 → 确认。

        Args: entry。
        """
        self._idle.clear()
        message = run_queue.decode(entry.fields)
        token = bind_log_context(
            trace_id=parse_traceparent(entry.fields.get("traceparent"))
        )
        try:
            if message is None:
                _logger.error(
                    "modeling_message_unreadable",
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

    async def _process(self, message: run_queue.RunMessage) -> None:
        """跑一次运行。异常一律记录，循环必须活着。

        Args: message。
        """
        options = self._options
        try:
            report = await execute_run(
                self._sessions,
                run_id=message.run_id,
                options=DispatchOptions(
                    runner=PooledRunner(
                        self._pool, timeout_s=options.node_timeout_s
                    ),
                    tz_offset_minutes=options.tz_offset_minutes,
                    store=options.store,
                ),
            )
        except Exception as error:  # pragma: no cover - 依赖同时不可用
            _logger.error(
                "modeling_run_error",
                "运行编排抛出异常",
                run_id=str(message.run_id),
                error=error,
            )
            return
        _log_report(message, report.outcome, report.status)


def _log_report(
    message: run_queue.RunMessage, outcome: str, status: str
) -> None:
    """按这一次运行真实的去向记一条日志。

    ⚠ 跑完 / 中断 / 孤儿必须是三个 event：混成一条，被中断的运行在日志里与
    跑通的一模一样。
    Args: message, outcome, status。
    """
    run_id = str(message.run_id)
    if outcome == RUN_DONE:
        _logger.info(
            "modeling_run_finished", "运行结束", run_id=run_id, status=status
        )
    elif outcome == RUN_INTERRUPTED:
        _logger.warning(
            "modeling_run_interrupted",
            "上一次执行中断，本次不重放",
            run_id=run_id,
        )
    elif outcome == RUN_ORPHANED:
        _logger.warning(
            "modeling_run_orphaned", "运行已不存在或已终态", run_id=run_id
        )
