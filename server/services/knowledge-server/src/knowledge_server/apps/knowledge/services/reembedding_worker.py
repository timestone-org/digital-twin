"""后台整库重嵌：每次认领一批，成功后短事务切换活动索引。"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.crud import reembedding as jobs
from knowledge_server.apps.knowledge.models import KnowledgeBase, ReembeddingJob
from knowledge_server.apps.knowledge.services.embedding import SnapshotEmbedder
from knowledge_server.apps.knowledge.services.embedding.space import model_label
from knowledge_server.apps.knowledge.services.ingest_pipeline import Sessions
from lib.logging import bind_log_context, get_logger, reset_log_context
from lib.logging.trace import new_span_id, parse_traceparent
from lib.utils.timeutils import utcnow
from llmcore.embedding_snapshot import EmbeddingBatch

_logger = get_logger("knowledge.reembedding")
BATCH_TIMEOUT_S = 60.0
LEASE_SECONDS = 90
POLL_SECONDS = 1.0
MOVED = "库内容在重嵌期间发生了变化，请重新预览"
SWITCHED = "目标嵌入空间已改变，请重新预览"
FAILED_BATCH = "目标模型未能返回本批全部向量，已保留当前索引"


@dataclass(frozen=True)
class Work:
    job: uuid.UUID
    base: uuid.UUID
    token: uuid.UUID
    target: str
    dimensions: int
    trace: str


def _finish(
    session: AsyncSession,
    job: ReembeddingJob,
    error: str | None,
    prior: tuple[str | None, uuid.UUID | None] = (None, None),
) -> None:
    job.status = "failed" if error else "succeeded"
    job.error_message = error
    job.finished_at = utcnow()
    job.lease_expires_at = None
    job.lease_token = None
    jobs.add_audit(
        session,
        job,
        jobs.AuditActor(
            job.requested_by,
            job.requested_ip,
            parse_traceparent(job.traceparent) or "",
            *prior,
        ),
        job.status,
    )


@dataclass(frozen=True)
class ReembeddingSteps:
    sessions: Sessions
    embedder: SnapshotEmbedder
    refresh: Callable[[], Awaitable[object]]
    batch_size: int

    async def run_one(self) -> bool:
        """认领并执行一批；空闲时回收有限量的未发布向量。"""
        async with self.sessions() as session:
            row = await jobs.claim(session, LEASE_SECONDS)
            if row is None:
                return False
            if row.lease_token is None:
                raise RuntimeError("重嵌任务未取得处理租约")
            work = Work(
                row.id,
                row.base_id,
                row.lease_token,
                row.target_space_id,
                row.target_dimensions,
                row.traceparent,
            )
        token = bind_log_context(
            trace_id=parse_traceparent(work.trace), span_id=new_span_id()
        )
        try:
            try:
                async with asyncio.timeout(BATCH_TIMEOUT_S):
                    await self._process(work)
            except TimeoutError:
                await self._fail(work, FAILED_BATCH)
        finally:
            reset_log_context(token)
        return True

    async def cleanup(self) -> None:
        """分批清理所属业务已结束的暂存。"""
        async with self.sessions() as session:
            await jobs.sweep(session, self.batch_size)

    async def _process(self, work: Work) -> None:
        try:
            await self.refresh()
        except Exception:
            await self._fail(work, FAILED_BATCH)
            return
        batch = await self._read(work)
        if not batch:
            return
        try:
            answer = await self.embedder.embed_batch(
                [body for _, body in batch]
            )
        except Exception as error:
            _logger.warning(
                "reembedding_model_failed",
                "重嵌模型未完成本批",
                reason=type(error).__name__,
            )
            await self._fail(work, FAILED_BATCH)
            return
        await self._write(work, batch, answer)

    async def _owned(
        self, session: AsyncSession, work: Work
    ) -> tuple[KnowledgeBase, ReembeddingJob] | None:
        base = await jobs.lock_base(session, work.base)
        job = await jobs.owns(session, work.base, work.job, work.token)
        if base is None or job is None:
            return None
        space = self.embedder.space
        if (base.content_revision or 0) != job.expected_revision:
            _finish(session, job, MOVED)
            return None
        if work.dimensions != await jobs.index_dimensions(session):
            _finish(
                session, job, "任务与数据库向量列的维数不符，已保留当前索引"
            )
            return None
        if space is None or space.identity != work.target:
            _finish(session, job, SWITCHED)
            return None
        return base, job

    async def _read(self, work: Work) -> list[tuple[uuid.UUID, str]]:
        async with self.sessions() as session:
            owned = await self._owned(session, work)
            if owned is None:
                return []
            base, job = owned
            rows = await jobs.remaining(session, job, self.batch_size)
            if rows:
                return rows
            source = await jobs.corpus(session, base.id)
            actual = await jobs.count_vectors(session, job.id)
            if (
                source.unready
                or source.documents != job.total_documents
                or source.chunks != job.total_chunks
                or actual != job.total_chunks
                or job.completed_chunks != actual
            ):
                _finish(session, job, MOVED)
            else:
                await jobs.complete_deferred_documents(session, base.id)
                prior = (
                    base.embedding_space_id,
                    base.active_embedding_generation_id,
                )
                base.active_embedding_generation_id = job.id
                base.embedding_space_id = job.target_space_id
                base.embedding_model = model_label(job.target_model)
                base.dimensions = job.target_dimensions
                _finish(session, job, None, prior)
            return []

    async def _write(
        self,
        work: Work,
        batch: list[tuple[uuid.UUID, str]],
        answer: EmbeddingBatch,
    ) -> None:
        async with self.sessions() as session:
            found = await self._owned(session, work)
            if found is None:
                return
            _, job = found
            if (
                answer.identity != work.target
                or answer.model != job.target_model
            ):
                _finish(session, job, SWITCHED)
                return
            if len(batch) != len(answer.vectors) or any(
                len(v) != work.dimensions for v in answer.vectors
            ):
                _finish(session, job, FAILED_BATCH)
                return
            rows = [
                (item[0], vector)
                for item, vector in zip(batch, answer.vectors, strict=True)
            ]
            await jobs.put_vectors(session, job.id, rows)
            job.completed_chunks += len(rows)
            job.lease_token = None
            job.lease_expires_at = None

    async def _fail(self, work: Work, reason: str) -> None:
        async with self.sessions() as session:
            job = await jobs.owns(session, work.base, work.job, work.token)
            if job is not None:
                _finish(session, job, reason)


class ReembeddingConsumer:
    """由知识 worker 运行的持久队列消费循环。"""

    def __init__(self, steps: ReembeddingSteps) -> None:
        self._steps = steps
        self._stop = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()
        self._cleanup_at = 0.0

    async def run(self) -> None:
        while not self._stop.is_set():
            self._idle.clear()
            try:
                worked = await self._steps.run_one()
                now = asyncio.get_running_loop().time()
                if not worked and now >= self._cleanup_at:
                    self._cleanup_at = now + 60.0
                    await self._steps.cleanup()
            except Exception as error:
                _logger.warning(
                    "reembedding_worker_unavailable",
                    "重嵌数据库暂不可用",
                    reason=type(error).__name__,
                )
                worked = False
            finally:
                self._idle.set()
            if not worked:
                with suppress(TimeoutError):
                    await asyncio.wait_for(self._stop.wait(), POLL_SECONDS)

    def stop(self) -> None:
        self._stop.set()

    async def drain(self, timeout_s: float) -> None:
        if not self._idle.is_set():
            with suppress(TimeoutError):
                await asyncio.wait_for(self._idle.wait(), timeout_s)
