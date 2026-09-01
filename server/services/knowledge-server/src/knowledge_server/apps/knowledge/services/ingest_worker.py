"""摄取的消费循环：从流里取任务、跑完管线、确认。

⚠ 关停顺序是「停止取新消息 → 跑完手上这条 → 退出」，绝不能跑到一半就退且
已经确认（runtime-resilience §8）。

⚠ **不自动重试**：一份解不动的文档重试一万次也解不动，而重试会把 worker 占满。
失败即写 `failed` + 一句人话，由人在界面上按「重新解析」——这条链路上负责
重试的那一层是人按的那一下。

⚠ 但「此刻拿不到」是另一档：对方抖了一下时**不确认**，让消息被重新认领。
两档混在一起的话，一次对象存储抖动会把那份文档永久判死。
"""

import asyncio
import uuid
from dataclasses import dataclass

from knowledge_server.apps.knowledge.services import ingest_queue
from knowledge_server.apps.knowledge.services.ingest_pipeline import (
    IngestDeps,
    IngestFailed,
    ingest,
    mark_failed,
)
from knowledge_server.apps.knowledge.services.sources import SourceUnavailable
from lib.db import Database
from lib.logging import (
    bind_log_context,
    get_logger,
    parse_traceparent,
    reset_log_context,
)
from lib.stream import StreamEntry, StreamGroup, StreamLike

_logger = get_logger("knowledge.ingest_worker")


@dataclass(frozen=True)
class ConsumerOptions:
    """一条消费循环的运行参数。"""

    target: StreamGroup
    block_ms: int = 5_000
    batch: int = 1
    # 一条消息滞留多久算掉队，由别的消费者认领
    claim_idle_ms: int = 5 * 60 * 1000


class IngestConsumer:
    """从流里取摄取任务、跑完、确认。"""

    def __init__(
        self,
        *,
        stream: StreamLike,
        database: Database,
        deps: IngestDeps,
        options: ConsumerOptions,
    ) -> None:
        self._stream = stream
        self._database = database
        self._deps = deps
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
                "knowledge_ingest_drain_timeout",
                "在途摄取未能在宽限期内跑完，未确认的消息会被重新认领",
            )

    async def run(self) -> None:
        """常驻循环。

        ⚠ 偶发错误记录后继续，否则一次抖动会让循环永久停止——而现象是
        「队列不动了」，服务本身还健康着。

        ⚠ 每一轮先认领一次掉队的消息：某个副本在跑到一半时被杀掉，它手上那条
        既没确认也没人管，不认领就永远卡在待处理列表里。
        """
        await self._stream.ensure_group(self._options.target)
        _logger.info("knowledge_ingest_started", "摄取消费者已启动")
        while not self._is_stopping:
            entries = await self._taken()
            for entry in entries:
                await self._handle(entry)

    async def _taken(self) -> list[StreamEntry]:
        """取一批：先认领掉队的，没有再等新的。"""
        try:
            stale = await self._stream.claim_stale(
                self._options.target,
                min_idle_ms=self._options.claim_idle_ms,
                count=self._options.batch,
            )
            if stale:
                return stale
            return await self._stream.read_group(
                self._options.target,
                count=self._options.batch,
                block_ms=self._options.block_ms,
            )
        except Exception as error:
            _logger.error(
                "knowledge_ingest_read_failed", "取摄取任务失败", error=error
            )
            await asyncio.sleep(self._options.block_ms / 1000)
            return []

    async def _handle(self, entry: StreamEntry) -> None:
        """跑一条。

        ⚠ 三种收场三种做法：
        - 跑完了 / 这份文档没救了 → **确认**，不再重投；
        - 此刻拿不到（对方抖了一下）→ **不确认**，让它被重新认领；
        - 读不懂的消息 → 确认并丢弃，否则它会被无限认领重投。

        Args: entry。
        """
        self._idle.clear()
        # ⚠ 从信封里把 trace 接回来：队列不会自动传播它，不接的话这一跳之后的
        # 每一条日志都挂在一个新的 trace 上，而链路从外面看是断的
        token = bind_log_context(
            trace_id=parse_traceparent(entry.fields.get("traceparent"))
        )
        try:
            message = ingest_queue.decode(entry.fields)
            if message is None:
                _logger.warning(
                    "knowledge_ingest_unreadable",
                    "读不懂的摄取任务，丢弃",
                    entry_id=entry.entry_id,
                )
                await self._ack(entry)
                return
            await self._run_one(message.document_id, entry)
        finally:
            reset_log_context(token)
            self._idle.set()

    async def _run_one(
        self, document_id: uuid.UUID, entry: StreamEntry
    ) -> None:
        """跑一次管线，按收场决定确认与否。

        Args: document_id, entry。
        """
        try:
            await ingest(self._database.session, self._deps, document_id)
        except SourceUnavailable as error:
            # ⚠ 不确认：这一档重试有意义，让它被重新认领
            _logger.warning(
                "knowledge_ingest_deferred",
                "上游此刻拿不到，这条稍后重新认领",
                entry_id=entry.entry_id,
                error=error,
            )
            return
        except IngestFailed as error:
            await self._fail(document_id, str(error))
        except Exception as error:
            _logger.error(
                "knowledge_ingest_crashed",
                "摄取异常，已记失败并确认不再重投",
                entry_id=entry.entry_id,
                error=error,
            )
            await self._fail(document_id, "摄取时出了意料之外的错")
        await self._ack(entry)

    async def _fail(self, document_id: uuid.UUID, reason: str) -> None:
        await mark_failed(self._database.session, document_id, reason)

    async def _ack(self, entry: StreamEntry) -> None:
        try:
            await self._stream.ack(self._options.target, entry.entry_id)
        except Exception as error:
            # 确认失败不致命：这条会被别人认领回去，而消费者是幂等的
            _logger.warning(
                "knowledge_ingest_ack_failed",
                "摄取任务确认失败，会被重新认领",
                entry_id=entry.entry_id,
                error=error,
            )
