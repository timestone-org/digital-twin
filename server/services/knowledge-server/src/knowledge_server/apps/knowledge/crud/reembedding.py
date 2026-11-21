"""同一知识库的重嵌任务、语料计数和审计。"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.crud.vector_format import literal
from knowledge_server.apps.knowledge.models import (
    KnowledgeBase,
    ReembeddingAudit,
    ReembeddingJob,
)
from lib.utils.ids import uuid7

ACTIVE = ("pending", "running")


@dataclass(frozen=True)
class Corpus:
    documents: int
    chunks: int
    unready: int


_COUNTS = text("""
    SELECT count(*) AS documents, coalesce(sum(rows.n), 0) AS chunks,
           count(*) FILTER (WHERE (d.status != 'ready' AND NOT
                (d.status='failed' AND d.embedding_deferred IS TRUE))
                             OR rows.n IS NULL
                             OR d.chunk_count != rows.n) AS unready
    FROM knowledge.kb_documents d
    LEFT JOIN (
        SELECT document_id, count(*) AS n FROM knowledge.kb_chunks
        WHERE base_id = :base GROUP BY document_id
    ) rows ON rows.document_id = d.id WHERE d.base_id = :base
      AND d.source_revision_state IS DISTINCT FROM 'historical'
""")


_VECTOR_WIDTH = text("""
    SELECT CASE WHEN count(*) = 3 AND min(a.atttypmod) = max(a.atttypmod)
                AND min(a.atttypmod) > 0 THEN min(a.atttypmod) END
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'knowledge' AND a.attname = 'embedding'
      AND NOT a.attisdropped AND c.relname IN (
          'kb_chunk_embeddings', 'kb_generation_embeddings', 'kb_ingest_vectors'
      )
""")


async def index_dimensions(session: AsyncSession) -> int | None:
    """读取行向量、代次和摄取暂存的共同物理维数。Args: session。"""
    value = await session.scalar(_VECTOR_WIDTH)
    return value if isinstance(value, int) else None


async def corpus(session: AsyncSession, base_id: uuid.UUID) -> Corpus:
    """统计每篇文档已持久化的原文块。Args: session, base_id。"""
    rows = await session.execute(_COUNTS, {"base": base_id})
    documents, chunks, unready = rows.tuples().one()
    return Corpus(int(documents), int(chunks), int(unready))


async def lock_base(
    session: AsyncSession, base_id: uuid.UUID
) -> KnowledgeBase | None:
    """串行化同库内容修订与代次操作。Args: session, base_id。"""
    return await session.scalar(
        select(KnowledgeBase)
        .where(KnowledgeBase.id == base_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )


async def active(
    session: AsyncSession, base_id: uuid.UUID
) -> ReembeddingJob | None:
    """读取当前在途任务。Args: session, base_id。"""
    return await session.scalar(
        select(ReembeddingJob).where(
            ReembeddingJob.base_id == base_id, ReembeddingJob.status.in_(ACTIVE)
        )
    )


async def previous(
    session: AsyncSession, base_id: uuid.UUID, actor: uuid.UUID, key: str
) -> ReembeddingJob | None:
    """读取同一账号已提交的操作。Args: session, base_id, actor, key。"""
    return await session.scalar(
        select(ReembeddingJob).where(
            ReembeddingJob.base_id == base_id,
            ReembeddingJob.requested_by == actor,
            ReembeddingJob.request_key_hash == key,
        )
    )


async def get_job(
    session: AsyncSession,
    base_id: uuid.UUID,
    identity: uuid.UUID,
    *,
    should_lock: bool = False,
) -> ReembeddingJob | None:
    """只取本库的任务。Args: session, base_id, identity, should_lock。"""
    statement = (
        select(ReembeddingJob)
        .where(ReembeddingJob.base_id == base_id, ReembeddingJob.id == identity)
        .execution_options(populate_existing=True)
    )
    if should_lock:
        statement = statement.with_for_update()
    return await session.scalar(statement)


async def list_jobs(
    session: AsyncSession, base_id: uuid.UUID, offset: int, limit: int
) -> tuple[Sequence[ReembeddingJob], int]:
    """读取有限页任务。Args: session, base_id, offset, limit。"""
    match = ReembeddingJob.base_id == base_id
    total = await session.scalar(
        select(func.count()).select_from(ReembeddingJob).where(match)
    )
    rows = await session.scalars(
        select(ReembeddingJob)
        .where(match)
        .order_by(ReembeddingJob.created_at.desc(), ReembeddingJob.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return rows.all(), total or 0


@dataclass(frozen=True)
class AuditActor:
    identity: uuid.UUID
    source_ip: str | None
    trace: str
    prior_space: str | None = None
    prior_generation: uuid.UUID | None = None


def add_audit(
    session: AsyncSession,
    job: ReembeddingJob,
    actor: AuditActor,
    action: str,
) -> None:
    """记录一次管理操作。Args: session, job, actor, action。"""
    session.add(
        ReembeddingAudit(
            base_id=job.base_id,
            job_id=job.id,
            actor_id=actor.identity,
            source_ip=actor.source_ip,
            prior_space_id=actor.prior_space,
            prior_generation_id=actor.prior_generation,
            action=action,
            trace_id=actor.trace,
        )
    )


async def claim(
    session: AsyncSession, lease_seconds: int
) -> ReembeddingJob | None:
    """认领下一批或接手到期任务。Args: session, lease_seconds。"""
    now = (await session.execute(select(func.clock_timestamp()))).scalar_one()
    row = await session.scalar(
        select(ReembeddingJob)
        .where(
            ReembeddingJob.status.in_(ACTIVE),
            (
                ReembeddingJob.lease_token.is_(None)
                | (ReembeddingJob.lease_expires_at < now)
            ),
        )
        .order_by(ReembeddingJob.created_at, ReembeddingJob.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if row is not None:
        row.status = "running"
        row.lease_token = uuid7()
        row.lease_expires_at = now + timedelta(seconds=lease_seconds)
    return row


async def owns(
    session: AsyncSession,
    base_id: uuid.UUID,
    job_id: uuid.UUID,
    token: uuid.UUID,
) -> ReembeddingJob | None:
    """核对当前工作租约。Args: session, base_id, job_id, token。"""
    return await session.scalar(
        select(ReembeddingJob)
        .where(
            ReembeddingJob.base_id == base_id,
            ReembeddingJob.id == job_id,
            ReembeddingJob.status == "running",
            ReembeddingJob.lease_token == token,
            ReembeddingJob.lease_expires_at > func.clock_timestamp(),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def remaining(
    session: AsyncSession, job: ReembeddingJob, limit: int
) -> list[tuple[uuid.UUID, str]]:
    """按固定顺序读取尚无目标向量的原文。Args: session, job, limit。"""
    result = await session.execute(
        text("""
        SELECT c.id, c.text FROM knowledge.kb_chunks c
        JOIN knowledge.kb_documents d ON d.id=c.document_id
        WHERE c.base_id=:base
          AND d.source_revision_state IS DISTINCT FROM 'historical'
        AND NOT EXISTS (
          SELECT 1 FROM knowledge.kb_generation_embeddings e
          WHERE e.generation_id=:job AND e.chunk_id=c.id
        ) ORDER BY c.id LIMIT :limit
    """),
        {"base": job.base_id, "job": job.id, "limit": limit},
    )
    return [(identity, body) for identity, body in result.tuples()]


async def put_vectors(
    session: AsyncSession,
    generation: uuid.UUID,
    rows: Sequence[tuple[uuid.UUID, list[float]]],
) -> None:
    """写入一批代次向量。Args: session, generation, rows。"""
    if not rows:
        return
    await session.execute(
        text("""
        INSERT INTO knowledge.kb_generation_embeddings
            (generation_id,chunk_id,embedding)
        VALUES(:generation,:chunk,CAST(:vector AS knowledge.vector))
        ON CONFLICT(generation_id,chunk_id)
            DO UPDATE SET embedding=EXCLUDED.embedding
    """),
        [
            {
                "generation": generation,
                "chunk": chunk,
                "vector": literal(vector),
            }
            for chunk, vector in rows
        ],
    )


async def count_vectors(session: AsyncSession, identity: uuid.UUID) -> int:
    """读取目标代次实际写入量。Args: session, identity。"""
    answer = await session.scalar(
        text(
            "SELECT count(*) FROM knowledge.kb_generation_embeddings "
            "WHERE generation_id=:id"
        ),
        {"id": identity},
    )
    return int(answer or 0)


async def sweep(session: AsyncSession, limit: int) -> int:
    """分批移除未发布的失败、已取消或已替换代次的向量。Args: session, limit。"""
    rows = await session.execute(
        text("""
        DELETE FROM knowledge.kb_generation_embeddings e
        USING (
          SELECT v.generation_id,v.chunk_id
          FROM knowledge.kb_generation_embeddings v
          JOIN knowledge.kb_reembeddings j ON v.generation_id=j.id
          JOIN knowledge.kb_bases b ON b.id=j.base_id
          WHERE j.status IN ('failed','cancelled','succeeded')
            AND b.active_embedding_generation_id IS DISTINCT FROM j.id
          LIMIT :limit FOR UPDATE OF v SKIP LOCKED
        ) old
        WHERE e.generation_id=old.generation_id AND e.chunk_id=old.chunk_id
        RETURNING e.chunk_id
    """),
        {"limit": limit},
    )
    removed = len(rows.all())
    temporary = await session.execute(
        text("""
        DELETE FROM knowledge.kb_ingest_vectors s USING (
            SELECT t.document_id, t.attempt, t.ordinal
            FROM knowledge.kb_ingest_vectors t
            JOIN knowledge.kb_documents d ON d.id=t.document_id
            WHERE d.status IN ('ready','failed')
              AND t.created_at < now() - interval '1 hour'
            LIMIT :limit FOR UPDATE OF t SKIP LOCKED
        ) old
        WHERE (s.document_id,s.attempt,s.ordinal) =
              (old.document_id,old.attempt,old.ordinal) RETURNING s.ordinal
    """),
        {"limit": limit},
    )
    return removed + len(temporary.all())


async def complete_deferred_documents(
    session: AsyncSession, base_id: uuid.UUID
) -> None:
    """切换时完成已经解析并有全量目标向量的文档。Args: session, base_id。"""
    await session.execute(
        text("""
        UPDATE knowledge.kb_documents
        SET status='ready', embedding_deferred=false, failure_reason='',
            ready_at=now(), updated_at=now()
        WHERE base_id=:base AND status='failed' AND embedding_deferred IS TRUE
          AND source_revision_state IS DISTINCT FROM 'historical'
    """),
        {"base": base_id},
    )


async def deferred_are_writable(
    session: AsyncSession, base_id: uuid.UUID
) -> bool:
    """已拿库锁时不等待其他写者占用的文档。Args: session, base_id。"""
    result = await session.scalar(
        text("""
        WITH wanted AS MATERIALIZED (
          SELECT id FROM knowledge.kb_documents
          WHERE base_id=:base AND status='failed' AND embedding_deferred IS TRUE
          AND source_revision_state IS DISTINCT FROM 'historical'
        ), locked AS MATERIALIZED (
          SELECT d.id FROM knowledge.kb_documents d JOIN wanted w ON w.id=d.id
          ORDER BY d.id FOR NO KEY UPDATE OF d SKIP LOCKED
        )
        SELECT (SELECT count(*) FROM locked)=(SELECT count(*) FROM wanted)
    """),
        {"base": base_id},
    )
    return bool(result)


async def chunks_are_referenceable(
    session: AsyncSession, base_id: uuid.UUID, ids: Sequence[uuid.UUID]
) -> bool:
    """在插入向量外键前非阻塞核对本批所有块。Args: session, base_id, ids。"""
    result = await session.scalar(
        text("""
        SELECT count(*) FROM (
          SELECT id FROM knowledge.kb_chunks
          WHERE base_id=:base AND id=ANY(CAST(:ids AS uuid[]))
          ORDER BY id FOR KEY SHARE SKIP LOCKED
        ) locked
    """),
        {"base": base_id, "ids": list(ids)},
    )
    return result == len(ids)
