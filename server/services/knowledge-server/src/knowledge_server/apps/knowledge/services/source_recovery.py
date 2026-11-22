"""在短事务中接续已完成或投递中断的来源版本。"""

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.crud import source_records
from knowledge_server.apps.knowledge.models import KnowledgeDocument
from knowledge_server.apps.knowledge.services import document_service
from lib.stream import StreamGroup, StreamLike
from lib.utils.ids import uuid7
from lib.utils.timeutils import utcnow

type Sessions = Callable[[], AbstractAsyncContextManager[AsyncSession]]

_RECLAIM = text("""
    WITH ready AS MATERIALIZED (
        SELECT d.base_id,d.id FROM knowledge.kb_source_records r
        JOIN knowledge.kb_documents d ON d.id=r.pending_document_id
        WHERE r.pending_document_id IS NOT NULL AND d.status='ready'
        ORDER BY r.pending_document_id LIMIT 32
    ), stale AS MATERIALIZED (
        SELECT d.base_id,d.id FROM knowledge.kb_documents d
        WHERE d.status='pending' AND d.updated_at < :cutoff
          AND d.source_revision_state IN ('pending','current')
        ORDER BY d.updated_at,d.id LIMIT 32
    ), candidates AS (
        SELECT base_id,id,0 AS priority FROM ready
        UNION ALL SELECT base_id,id,1 FROM stale
    )
    SELECT b.id,c.id FROM candidates c
    JOIN knowledge.kb_bases b ON b.id=c.base_id
    ORDER BY c.priority,c.id LIMIT 1 FOR NO KEY UPDATE OF b SKIP LOCKED
""")


@dataclass(frozen=True)
class SourceVersionRecovery:
    sessions: Sessions
    stream: StreamLike
    target: StreamGroup
    pending_grace_s: float

    async def run_one(self) -> bool:
        """从持久记录接续一种待处理状态。"""
        cutoff = utcnow() - timedelta(seconds=self.pending_grace_s)
        async with self.sessions() as session:
            rows = await session.execute(_RECLAIM, {"cutoff": cutoff})
            candidate = rows.tuples().one_or_none()
            if candidate is None:
                return False
            _, identity = candidate
            if not await source_records.lock_documents(session, {identity}):
                return False
            doc = await session.get(
                KnowledgeDocument, identity, populate_existing=True
            )
            if doc is None:
                return False
            if (
                doc.status == "ready"
                and await source_records.has_current_vectors(session, doc)
            ):
                return await self._publish(session, doc)
            if doc.status != "ready" and (
                doc.status != "pending" or doc.updated_at >= cutoff
            ):
                return False
            return await self._redispatch(session, doc)

    async def _publish(
        self, session: AsyncSession, document: KnowledgeDocument
    ) -> bool:
        async with session.begin_nested() as publishing:
            published = await source_records.publish_ready(
                session, document.base_id, document.id
            )
            if not published:
                await publishing.rollback()
        return published

    async def _redispatch(
        self, session: AsyncSession, document: KnowledgeDocument
    ) -> bool:
        generation = uuid7()
        if not await crud.document.mark_requeued(
            session, document.id, generation
        ):
            return False
        await session.refresh(document)
        document_service.queue_ingest(
            session,
            self.stream,
            self.target,
            document_service.document_out(document),
            generation,
        )
        return True
