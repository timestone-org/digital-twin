"""单文档重新摄取出现换档时保留可读块，未认证文本可由整库重嵌恢复。"""

import uuid
from collections.abc import Sequence
from dataclasses import replace

import pytest
from integration.test_ingest_pipeline import (
    BODY,
    _deps,
    _pair,
    _seeded,
    _Source,
)
from integration.test_reembedding_worker import (
    LocalEmbedder,
    Sessions,
    local_space,
    unchanged,
)
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.models import (
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
)
from knowledge_server.apps.knowledge.schemas.reembedding import (
    ReembeddingStartIn,
)
from knowledge_server.apps.knowledge.services import reembedding
from knowledge_server.apps.knowledge.services.ingest_pipeline import (
    IngestFailed,
    ingest,
)
from knowledge_server.apps.knowledge.services.reembedding_worker import (
    ReembeddingSteps,
)
from llmcore.embedding_snapshot import EmbeddingBatch

pytestmark = pytest.mark.requires_postgres


class Switching(LocalEmbedder):
    async def embed_batch(self, texts: Sequence[str]) -> EmbeddingBatch:
        served = await super().embed_batch(texts)
        self.space = local_space(self.dimensions, "b")
        return served


async def test_changed_batch_preserves_previous_chunks_then_admin_can_recover(
    db_sessions: Sessions,
    db_dimensions: int,
) -> None:
    base_id, doc_id = await _seeded(db_sessions)
    stable = LocalEmbedder(db_dimensions)
    deps = replace(
        _deps(_Source(BODY.encode()), stable, _pair(db_dimensions)),
        batch_size=1,
    )
    try:
        assert await ingest(db_sessions, deps, doc_id) == "ready"
        async with db_sessions() as session:
            old = await _chunk_ids(session, doc_id)
            doc = await session.get(KnowledgeDocument, doc_id)
            assert doc is not None
            doc.status = "pending"
        with pytest.raises(IngestFailed, match="空间"):
            await ingest(
                db_sessions,
                replace(deps, embedder=Switching(db_dimensions)),
                doc_id,
            )
        async with db_sessions() as session:
            remaining = await _chunk_ids(session, doc_id)
            assert remaining == old
            doc = await session.get(KnowledgeDocument, doc_id)
            assert doc is not None
            assert doc.embedding_deferred is True
            assert doc.status == "failed"
            assert (
                await session.scalar(
                    text(
                        "SELECT count(*) FROM knowledge.kb_ingest_vectors "
                        "WHERE document_id=:id"
                    ),
                    {"id": doc_id},
                )
                == 0
            )
        await _restore_library(db_sessions, base_id, doc_id, stable)
    finally:
        deps.pool.shutdown()


async def _restore_library(
    db_sessions: Sessions,
    base_id: uuid.UUID,
    doc_id: uuid.UUID,
    stable: LocalEmbedder,
) -> None:
    space = local_space(stable.dimensions)
    async with db_sessions() as session:
        preview = await reembedding.preview(session, base_id, space)
        assert preview.can_start
        start = reembedding.StartRequest(
            base_id,
            uuid.uuid4(),
            "release",
            ReembeddingStartIn(
                target_space_id=space.identity,
                expected_revision=preview.content_revision,
            ),
        )
        job = await reembedding.start(session, start, space)
    worker = ReembeddingSteps(db_sessions, stable, unchanged, 32)
    await worker.run_one()
    await worker.run_one()
    async with db_sessions() as session:
        base = await session.get(KnowledgeBase, base_id)
        assert base is not None
        assert base.active_embedding_generation_id == job.id
        doc = await session.get(KnowledgeDocument, doc_id)
        assert doc is not None
        assert doc.status == "ready"
        assert doc.embedding_deferred is False


async def _chunk_ids(
    session: AsyncSession, doc_id: uuid.UUID
) -> Sequence[uuid.UUID]:
    return (
        await session.scalars(
            select(KnowledgeChunk.id)
            .where(KnowledgeChunk.document_id == doc_id)
            .order_by(KnowledgeChunk.ordinal)
        )
    ).all()


async def test_incompatible_physical_width_is_deferred_before_a_model_call(
    db_sessions: Sessions, db_dimensions: int
) -> None:
    _, document = await _seeded(db_sessions)
    calls: list[int] = []

    class WrongWidth(LocalEmbedder):
        async def embed_batch(self, texts: Sequence[str]) -> EmbeddingBatch:
            calls.append(len(texts))
            return await super().embed_batch(texts)

    model = WrongWidth(db_dimensions + 1)
    deps = _deps(_Source(BODY.encode()), model, _pair(db_dimensions))
    try:
        with pytest.raises(IngestFailed, match="维数"):
            await ingest(db_sessions, deps, document)
    finally:
        deps.pool.shutdown()
    assert calls == []
    async with db_sessions() as session:
        doc = await session.get(KnowledgeDocument, document)
        assert doc is not None
        assert doc.embedding_deferred
        assert doc.chunk_count > 0
