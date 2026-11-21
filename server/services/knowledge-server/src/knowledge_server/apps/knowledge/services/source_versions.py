"""根据来源记录身份选择当前或待处理的不可变文档。"""

from dataclasses import dataclass, replace
from datetime import timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.crud import source_records as records
from knowledge_server.apps.knowledge.errors import SourceSyncConflict
from knowledge_server.apps.knowledge.models import (
    KnowledgeDocument,
    KnowledgeSourceRecord,
)
from lib.utils.ids import uuid7
from lib.utils.timeutils import utcnow


@dataclass(frozen=True)
class SourceItem:
    record_key: str
    write: crud.document.DocumentWrite


@dataclass(frozen=True)
class Registration:
    is_changed: bool
    queued: KnowledgeDocument | None


async def _stored(
    session: AsyncSession, write: crud.document.DocumentWrite
) -> tuple[KnowledgeDocument, bool]:
    found = await records.by_hash(session, write.base_id, write.content_hash)
    if found is not None:
        return found, False
    try:
        async with session.begin_nested():
            await crud.document.insert_document(
                session, replace(write, source_revision_state="pending")
            )
    except IntegrityError:
        other = await records.by_hash(
            session, write.base_id, write.content_hash
        )
        if other is None:
            raise
        return other, False
    new = await crud.document.get_document(session, write.document_id)
    if new is None:
        raise RuntimeError("新登记的文档不存在")
    return new, True


async def _resume_pending(
    session: AsyncSession, document: KnowledgeDocument, grace: timedelta
) -> Registration:
    if document.source_revision_state is None:
        return Registration(False, None)
    stalled = (
        document.status == "pending" and document.updated_at <= utcnow() - grace
    )
    if document.status != "failed" and not stalled:
        return Registration(False, None)
    if not await records.lock_documents(session, {document.id}):
        raise SourceSyncConflict("来源原文正在修改，请重新同步")
    generation = uuid7()
    if not await crud.document.mark_requeued(session, document.id, generation):
        return Registration(False, None)
    await session.refresh(document)
    return Registration(False, document)


async def observe(
    session: AsyncSession, item: SourceItem, grace: timedelta
) -> Registration:
    """登记原始记录身份并保留已发布的版本。Args: session, item, grace。"""
    write = item.write
    record = await records.claim(session, write.source_id, item.record_key)
    if record.record_key != item.record_key:
        raise SourceSyncConflict("上游记录标识无法唯一确认，请检查来源")
    document, is_new = await _stored(session, write)
    existing = record.current_document_id
    pending = record.pending_document_id
    if (pending is None and existing == document.id) or (
        pending == document.id and document.status != "ready"
    ):
        return await _resume_pending(session, document, grace)
    touched = {
        value for value in (existing, pending, document.id) if value is not None
    }
    if not await records.lock_documents(session, touched):
        raise SourceSyncConflict("来源原文正在修改，请重新同步")
    if (
        document.source_revision_state is None
        and document.source_id == write.source_id
    ):
        document.source_revision_state = "current"
    should_reindex = await _select_version(session, record, document)
    await session.flush()
    if (
        record.pending_document_id is not None
        and document.status == "ready"
        and not await records.publish_ready(session, write.base_id, document.id)
    ):
        raise SourceSyncConflict("来源原文正在修改，请重新同步")
    await records.refresh_visibility(session, touched)
    return Registration(
        is_new or existing is not None,
        document if is_new or should_reindex else None,
    )


async def _select_version(
    session: AsyncSession,
    record: KnowledgeSourceRecord,
    document: KnowledgeDocument,
) -> bool:
    """选择当前或候选版本，必要时重新为已有块编索引。

    Args: session, record, document。"""
    should_reindex = (
        document.status == "ready"
        and document.source_revision_state in ("historical", "pending")
        and not await records.has_current_vectors(session, document)
    )
    if should_reindex:
        document.status = "pending"
        document.ingest_generation = uuid7()
        document.failure_reason = ""
        document.ready_at = None
        record.pending_document_id = document.id
    elif record.current_document_id in (None, document.id):
        record.current_document_id = document.id
        record.pending_document_id = None
    else:
        record.pending_document_id = document.id
    return should_reindex
