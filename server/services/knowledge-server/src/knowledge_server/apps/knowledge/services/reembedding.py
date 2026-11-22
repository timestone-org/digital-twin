"""整库重嵌的预检、幂等启动与取消。"""

import hashlib
import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.crud import reembedding as jobs
from knowledge_server.apps.knowledge.errors import KnowledgeBaseNotFound
from knowledge_server.apps.knowledge.models import KnowledgeBase, ReembeddingJob
from knowledge_server.apps.knowledge.reembedding_errors import (
    CorpusUnavailable,
    PreviewChanged,
    ReembeddingInProgress,
    ReembeddingKeyConflict,
    ReembeddingNotFound,
)
from knowledge_server.apps.knowledge.schemas.reembedding import (
    ReembeddingJobOut,
    ReembeddingPreviewOut,
    ReembeddingStartIn,
)
from knowledge_server.apps.knowledge.services.embedding import EmbeddingSpace
from lib.logging import current_traceparent
from lib.logging.trace import parse_traceparent
from lib.utils.ids import uuid7
from lib.utils.timeutils import utcnow


@dataclass(frozen=True)
class StartRequest:
    base_id: uuid.UUID
    actor: uuid.UUID
    key: str
    body: ReembeddingStartIn
    source_ip: str | None = None


async def _base(session: AsyncSession, base_id: uuid.UUID) -> KnowledgeBase:
    row = await jobs.lock_base(session, base_id)
    if row is None:
        raise KnowledgeBaseNotFound("知识库不存在")
    return row


async def preview(
    session: AsyncSession,
    base_id: uuid.UUID,
    target: EmbeddingSpace | None,
) -> ReembeddingPreviewOut:
    """读取重嵌预检。Args: session, base_id, target。"""
    base = await _base(session, base_id)
    corpus = await jobs.corpus(session, base_id)
    if target is None:
        note = "当前无法核验目标嵌入模型，请检查模型目录与分配"
    elif target.dimensions != await jobs.index_dimensions(session):
        note = "目标模型与数据库向量列的维数不一致或库结构尚未就绪"
    elif await jobs.active(session, base_id) is not None:
        note = "这个库已有正在进行的重嵌任务"
    elif corpus.unready:
        note = "仍有文档未完成解析或缺少原文块，请先检查文档状态"
    else:
        note = ""
    return ReembeddingPreviewOut(
        target_model=target.model if target else None,
        target_dimensions=target.dimensions if target else None,
        target_space_id=target.identity if target else None,
        content_revision=base.content_revision or 0,
        total_documents=corpus.documents,
        total_chunks=corpus.chunks,
        can_start=not note,
        note=note,
    )


async def start(
    session: AsyncSession,
    request: StartRequest,
    target: EmbeddingSpace | None,
) -> ReembeddingJobOut:
    """建立已获确认的任务。Args: session, request, target。"""
    base = await _base(session, request.base_id)
    digest = hashlib.sha256(request.key.encode()).hexdigest()
    previous = await jobs.previous(session, base.id, request.actor, digest)
    if previous is not None:
        if (previous.target_space_id, previous.expected_revision) != (
            request.body.target_space_id,
            request.body.expected_revision,
        ):
            raise ReembeddingKeyConflict("同一幂等键已用于其他重嵌请求")
        return ReembeddingJobOut.model_validate(previous)
    if await jobs.active(session, base.id) is not None:
        raise ReembeddingInProgress("这个库已有正在进行的重嵌任务")
    if target is None or target.dimensions != await jobs.index_dimensions(
        session
    ):
        raise CorpusUnavailable("当前嵌入模型不可用或与数据库向量列的维数不符")
    if (
        target.identity != request.body.target_space_id
        or (base.content_revision or 0) != request.body.expected_revision
    ):
        raise PreviewChanged("库内容或目标嵌入空间已改变，请重新预览并确认")
    corpus = await jobs.corpus(session, base.id)
    if corpus.unready:
        raise CorpusUnavailable("仍有文档未完成解析或缺少原文块")
    job = _new_job(request, target, corpus, digest)
    session.add(job)
    jobs.add_audit(
        session,
        job,
        jobs.AuditActor(
            request.actor,
            request.source_ip,
            parse_traceparent(job.traceparent) or "",
        ),
        "requested",
    )
    await session.flush()
    return ReembeddingJobOut.model_validate(job)


def _new_job(
    request: StartRequest,
    target: EmbeddingSpace,
    corpus: jobs.Corpus,
    digest: str,
) -> ReembeddingJob:
    trace = current_traceparent()
    return ReembeddingJob(
        id=uuid7(),
        base_id=request.base_id,
        requested_by=request.actor,
        requested_ip=request.source_ip,
        request_key_hash=digest,
        target_space_id=target.identity,
        target_model=target.model,
        target_dimensions=target.dimensions,
        expected_revision=request.body.expected_revision,
        total_documents=corpus.documents,
        total_chunks=corpus.chunks,
        status="pending",
        traceparent=trace,
        completed_chunks=0,
    )


async def read(
    session: AsyncSession, base_id: uuid.UUID, job_id: uuid.UUID
) -> ReembeddingJobOut:
    """读取指定库的任务。Args: session, base_id, job_id。"""
    row = await jobs.get_job(session, base_id, job_id)
    if row is None:
        raise ReembeddingNotFound("这个库中没有该任务")
    return ReembeddingJobOut.model_validate(row)


async def cancel(
    session: AsyncSession,
    base_id: uuid.UUID,
    job_id: uuid.UUID,
    actor: uuid.UUID,
    source_ip: str | None = None,
) -> ReembeddingJobOut:
    """取消尚未发布的代次。Args: session, base_id, job_id, actor。"""
    await _base(session, base_id)
    row = await jobs.get_job(session, base_id, job_id, should_lock=True)
    if row is None:
        raise ReembeddingNotFound("这个库中没有该任务")
    if row.status in jobs.ACTIVE:
        row.status = "cancelled"
        row.finished_at = utcnow()
        row.lease_token = row.lease_expires_at = None
        jobs.add_audit(
            session,
            row,
            jobs.AuditActor(
                actor, source_ip, parse_traceparent(current_traceparent()) or ""
            ),
            "cancelled",
        )
        await session.flush()
    return ReembeddingJobOut.model_validate(row)
