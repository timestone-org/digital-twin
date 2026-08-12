"""抽取分片的消费循环。

一条消息一个事务、一条链路一个 trace。⚠ 消费者必须自己幂等：队列是
at-least-once，重复投递是常态（docs/agents/runtime-resilience.md §5）。
"""

import asyncio
from dataclasses import dataclass

from lib.db import Database
from lib.errors import DependencyUnavailable
from lib.logging import bind_log_context, get_logger, reset_log_context
from lib.web.middleware import parse_traceparent
from platform_server.apps.hvac.services import ac_startup_queue
from platform_server.apps.hvac.services.ac_startup_extract import (
    ExtractionContext,
    run_shard,
)
from platform_server.apps.hvac.services.ac_startup_service import (
    fail_shard,
    finalize_if_complete,
)
from platform_server.stream import StreamEntry, StreamGroup, StreamLike

_logger = get_logger("platform.hvac.ac_startup_worker")


@dataclass(frozen=True)
class ConsumerOptions:
    """消费循环的节奏参数。"""

    target: StreamGroup
    prefetch: int
    block_ms: int
    claim_idle_ms: int
    shard_timeout_s: float


class ShardConsumer:
    """从流里取分片任务、跑完、确认。

    ⚠ 关停顺序是「停止取新消息 → 跑完手上这条 → 退出」，绝不能跑到一半就退
    且已经确认（docs/agents/runtime-resilience.md §8）。
    """

    def __init__(
        self,
        *,
        database: Database,
        stream: StreamLike,
        context: ExtractionContext,
        options: ConsumerOptions,
    ) -> None:
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
        """等手上那条跑完，超时就放弃等待（消息没确认，会被别人认领回去）。

        Args: timeout_s。
        """
        try:
            async with asyncio.timeout(timeout_s):
                await self._idle.wait()
        except TimeoutError:
            _logger.warning(
                "ac_startup_worker_drain_timeout",
                "在途分片未能在宽限期内跑完，未确认的消息会被重新认领",
            )

    async def run(self) -> None:
        """常驻循环。⚠ 偶发错误记录后继续，否则一次抖动会让循环永久停止。"""
        await self._stream.ensure_group(self._options.target)
        _logger.info(
            "ac_startup_worker_started",
            "分片消费者已就绪",
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
            # ⚠ 队列抖一下不是「需要人介入」，按 observability.md 只报 WARNING：
            # 消费循环本来就会重试，而每个空转周期刷一条带堆栈的 ERROR，
            # 只会让真正需要人看的那条淹在里面
            _logger.warning(
                "ac_startup_worker_fetch_failed", "取消息失败", error=error
            )
            await asyncio.sleep(self._options.block_ms / 1000)
            return
        for entry in entries:
            if self._is_stopping:
                # 没确认的消息留在待确认表里，由别的消费者认领回去
                return
            await self._handle(entry)

    async def _fetch(self) -> list[StreamEntry]:
        """先认领滞留的，再取新的。

        ⚠ 认领这一步不能省：消费者崩在确认之前的那条消息会永远躺在待确认表
        里，at-least-once 就成了 at-most-once，而分片会静默地少跑一个。
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
        """处理一条消息：恢复链路 → 跑一片 → 确认。

        Args: entry。
        """
        self._idle.clear()
        message = ac_startup_queue.decode(entry.fields)
        token = bind_log_context(
            trace_id=parse_traceparent(entry.fields.get("traceparent"))
        )
        try:
            if message is None:
                _logger.error(
                    "ac_startup_message_unreadable",
                    "读不懂的队列消息，直接确认丢弃",
                    entry_id=entry.entry_id,
                )
            else:
                await self._process(message)
        finally:
            reset_log_context(token)
            await self._stream.ack(self._options.target, entry.entry_id)
            self._idle.set()

    async def _process(self, message: ac_startup_queue.ShardMessage) -> None:
        """跑一片并在全部跑完时收尾，各自一个事务。

        Args: message。
        """
        try:
            async with asyncio.timeout(self._options.shard_timeout_s):
                await self._run_one(message)
        # 一片失败不该让循环停下，也不该让上一批次受影响
        except Exception as error:
            _logger.error(
                "ac_startup_shard_error",
                "分片抽取抛出异常",
                batch_id=str(message.batch_id),
                month=message.month,
                error=error,
            )
            await self._record_failure(message, reason=str(error))
        await self._finalize(message)

    async def _run_one(self, message: ac_startup_queue.ShardMessage) -> None:
        async with self._database.session() as session:
            written = await run_shard(session, self._context, message)
        _logger.info(
            "ac_startup_shard_done",
            "分片抽取完成",
            batch_id=str(message.batch_id),
            month=message.month,
            episode_count=written,
        )

    async def _record_failure(
        self, message: ac_startup_queue.ShardMessage, *, reason: str
    ) -> None:
        try:
            async with self._database.session() as session:
                await fail_shard(session, message, reason=reason)
        # 连失败都记不下来时只剩日志，但循环必须活着
        except Exception as error:  # pragma: no cover - 依赖库同时不可用
            _logger.error(
                "ac_startup_shard_failure_unrecorded",
                "分片失败状态未能落库",
                error=error,
            )

    async def _finalize(self, message: ac_startup_queue.ShardMessage) -> None:
        try:
            async with self._database.session() as session:
                await finalize_if_complete(session, message.batch_id)
        # 收尾失败不该让这条消息重放：分片状态已经落库，下一片会再试一次
        except Exception as error:  # pragma: no cover - 依赖库同时不可用
            _logger.error(
                "ac_startup_batch_finalize_failed",
                "批次收尾失败",
                batch_id=str(message.batch_id),
                error=error,
            )
