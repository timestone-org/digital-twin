"""在库锁内按稳定记录身份关联文档，按批切换已经就绪的版本。"""

import hashlib
import uuid
from collections.abc import Collection

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.models import (
    KnowledgeDocument,
    KnowledgeSourceRecord,
)
from lib.utils.ids import uuid7

BATCH_SIZE = 128

_VISIBILITY = text("""
    WITH desired AS (
        SELECT d.id, CASE
          WHEN EXISTS (SELECT FROM knowledge.kb_source_records r
                       WHERE r.current_document_id=d.id) THEN 'current'
          WHEN EXISTS (SELECT FROM knowledge.kb_source_records r
                       WHERE r.pending_document_id=d.id) THEN 'pending'
          ELSE 'historical' END AS state
        FROM knowledge.kb_documents d
        WHERE d.id=ANY(CAST(:ids AS uuid[]))
          AND d.source_revision_state IS NOT NULL
    )
    UPDATE knowledge.kb_documents d
    SET source_revision_state=v.state, updated_at=now()
    FROM desired v WHERE d.id=v.id AND d.source_revision_state<>v.state
""")


async def claim(
    session: AsyncSession, source: uuid.UUID, record_key: str
) -> KnowledgeSourceRecord:
    """原子登记来源记录，返回已持久化的唯一身份。

    Args: session, source, record_key。"""
    digest = hashlib.sha256(record_key.encode("utf-8")).hexdigest()
    await session.execute(
        insert(KnowledgeSourceRecord)
        .values(
            id=uuid7(),
            source_id=source,
            record_key_hash=digest,
            record_key=record_key,
        )
        .on_conflict_do_nothing(constraint="uq_kb_source_records_identity")
    )
    rows = await session.scalars(
        select(KnowledgeSourceRecord)
        .where(
            KnowledgeSourceRecord.source_id == source,
            KnowledgeSourceRecord.record_key_hash == digest,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return rows.one()


async def by_hash(
    session: AsyncSession, base: uuid.UUID, digest: str
) -> KnowledgeDocument | None:
    """查当前库中内容一致的不可变快照。Args: session, base, digest。"""
    return await session.scalar(
        select(KnowledgeDocument)
        .where(
            KnowledgeDocument.base_id == base,
            KnowledgeDocument.content_hash == digest,
        )
        .execution_options(populate_existing=True)
    )


async def lock_documents(
    session: AsyncSession, documents: Collection[uuid.UUID]
) -> bool:
    """已持库锁时只认领可写的原文行。Args: session, documents。"""
    if not documents:
        return True
    owned = await session.scalars(
        select(KnowledgeDocument.id)
        .where(KnowledgeDocument.id.in_(documents))
        .order_by(KnowledgeDocument.id)
        .with_for_update(key_share=True, skip_locked=True)
    )
    return set(owned) == set(documents)


async def refresh_visibility(
    session: AsyncSession, documents: Collection[uuid.UUID]
) -> None:
    """同步当前和待处理的引用状态，保留独立上传的可见性。

    Args: session, documents。"""
    if documents:
        await session.execute(_VISIBILITY, {"ids": list(documents)})


async def publish_ready(
    session: AsyncSession,
    base_id: uuid.UUID,
    document_id: uuid.UUID | None = None,
) -> bool:
    """在同一事务把就绪候选设为当前版本。

    Args: session, base_id, document_id。"""
    query = (
        select(KnowledgeSourceRecord)
        .join(
            KnowledgeDocument,
            KnowledgeDocument.id == KnowledgeSourceRecord.pending_document_id,
        )
        .where(
            KnowledgeDocument.base_id == base_id,
            KnowledgeDocument.status == "ready",
        )
        .order_by(KnowledgeSourceRecord.id)
        .limit(BATCH_SIZE)
    )
    if document_id is not None:
        query = query.where(
            KnowledgeSourceRecord.pending_document_id == document_id
        )
    while rows := list((await session.scalars(query)).all()):
        touched = {
            identity
            for row in rows
            for identity in (row.current_document_id, row.pending_document_id)
            if identity is not None
        }
        if not await lock_documents(session, touched):
            return False
        await session.execute(
            update(KnowledgeSourceRecord)
            .where(KnowledgeSourceRecord.id.in_([row.id for row in rows]))
            .values(
                current_document_id=KnowledgeSourceRecord.pending_document_id,
                pending_document_id=None,
                updated_at=func.now(),
            )
        )
        await refresh_visibility(session, touched)
    return True


async def has_current_vectors(
    session: AsyncSession, document: KnowledgeDocument
) -> bool:
    """检查旧快照的每个块是否已进入当前向量代次。Args: session, document。"""
    found = await session.scalar(
        text("""
        SELECT b.embedding_space_id IS NOT NULL AND
          (d.chunk_count > 0 AND d.chunk_count=(
             SELECT count(*) FROM knowledge.kb_chunks c
             WHERE c.document_id=d.id AND (
               (b.active_embedding_generation_id IS NULL AND EXISTS (
                 SELECT FROM knowledge.kb_chunk_embeddings e
                 WHERE e.chunk_id=c.id
                   AND e.embedding_model='space:' || b.embedding_space_id))
               OR EXISTS (SELECT FROM knowledge.kb_generation_embeddings e
                          WHERE e.generation_id=b.active_embedding_generation_id
                            AND e.chunk_id=c.id)
             )))
        FROM knowledge.kb_documents d
        JOIN knowledge.kb_bases b ON b.id=d.base_id
        WHERE d.id=:document
    """),
        {"document": document.id},
    )
    return bool(found)
