"""真实 pgvector 上的分批构建、取消、冲突及整库切换。"""

import uuid
from collections.abc import Callable, Sequence

import pytest
from integration.conftest import CommittingSession
from integration.test_ingest_pipeline import _seeded
from sqlalchemy import select

from knowledge_server.apps.knowledge.crud import reembedding as jobs
from knowledge_server.apps.knowledge.models import (
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
    ReembeddingAudit,
)
from knowledge_server.apps.knowledge.schemas.reembedding import (
    ReembeddingStartIn,
)
from knowledge_server.apps.knowledge.services import reembedding
from knowledge_server.apps.knowledge.services.embedding import EmbeddingSpace
from knowledge_server.apps.knowledge.services.reembedding_worker import (
    ReembeddingSteps,
)
from llmcore.embedding_snapshot import EmbeddingBatch, embedding_identity

pytestmark = pytest.mark.requires_postgres
Sessions = Callable[[], CommittingSession]


def local_space(dimensions: int, provider: str = "a") -> EmbeddingSpace:
    name = "同名本地模型"
    return EmbeddingSpace(
        embedding_identity("http://local-fixture", name, dimensions, provider),
        name,
        dimensions,
    )


class LocalEmbedder:
    id = "local"
    model = "同名本地模型"
    max_input_tokens = 128
    can_embed = True
    failure = False

    def __init__(self, dimensions: int):
        self.dimensions = dimensions
        self.space: EmbeddingSpace | None = local_space(dimensions)

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [[1.0] + [0.0] * (self.dimensions - 1) for _ in texts]

    async def embed_batch(self, texts: Sequence[str]) -> EmbeddingBatch:
        if self.failure:
            raise RuntimeError("synthetic")
        assert self.space is not None
        return EmbeddingBatch(
            self.space.identity, self.space.model, await self.embed(texts)
        )


async def unchanged() -> None:
    pass


async def corpus(
    sessions: Sessions,
) -> tuple[uuid.UUID, uuid.UUID, list[uuid.UUID]]:
    base, document = await _seeded(sessions)
    async with sessions() as session:
        doc = await session.get(KnowledgeDocument, document)
        assert doc is not None
        doc.status = "ready"
        doc.chunk_count = 3
        chunks = [
            KnowledgeChunk(
                base_id=base,
                document_id=document,
                ordinal=n,
                text="原文" + str(n),
            )
            for n in range(3)
        ]
        session.add_all(chunks)
        await session.flush()
        result = [c.id for c in chunks]
    return base, document, result


async def start_job(
    sessions: Sessions,
    base: uuid.UUID,
    actor: uuid.UUID,
    target: EmbeddingSpace,
):
    async with sessions() as session:
        info = await reembedding.preview(session, base, target)
        assert info.can_start
        assert info.total_chunks == 3
        return await reembedding.start(
            session,
            reembedding.StartRequest(
                base,
                actor,
                str(uuid.uuid4()),
                ReembeddingStartIn(
                    target_space_id=target.identity,
                    expected_revision=info.content_revision,
                ),
            ),
            target,
        )


@pytest.mark.parametrize(
    "outcome", ["success", "failure", "cancel", "edit", "switch"]
)
async def test_only_a_complete_unchanged_target_is_published(
    db_sessions: Sessions, db_dimensions: int, outcome: str
) -> None:
    base, doc, chunk_ids = await corpus(db_sessions)
    actor = uuid.uuid4()
    space = local_space(db_dimensions)
    job = await start_job(db_sessions, base, actor, space)
    embedder = LocalEmbedder(db_dimensions)
    worker = ReembeddingSteps(db_sessions, embedder, unchanged, 2)
    assert await worker.run_one()
    async with db_sessions() as session:
        row = await session.get(KnowledgeBase, base)
        assert row is not None
        assert row.active_embedding_generation_id is None
        assert await jobs.count_vectors(session, job.id) == 2
        if outcome == "cancel":
            await reembedding.cancel(session, base, job.id, actor)
        if outcome == "edit":
            current = await session.get(KnowledgeChunk, chunk_ids[0])
            assert current is not None
            current.text = "手动更新的原文"
    if outcome == "switch":
        embedder.space = local_space(db_dimensions, "b")
    embedder.failure = outcome == "failure"
    await worker.run_one()
    if outcome == "success":
        await worker.run_one()
    await _assert_published(db_sessions, base, doc, job.id, outcome)


async def _assert_published(
    db_sessions: Sessions,
    base: uuid.UUID,
    doc: uuid.UUID,
    job_id: uuid.UUID,
    outcome: str,
) -> None:
    async with db_sessions() as session:
        current = await reembedding.read(session, base, job_id)
        stored = await session.get(KnowledgeBase, base)
        assert stored is not None
        if outcome == "success":
            assert current.status == "succeeded"
            assert current.completed_chunks == 3
            assert stored.active_embedding_generation_id == job_id
            assert (
                stored.embedding_space_id
                == local_space(stored.dimensions or 0).identity
            )
        else:
            assert current.status == (
                "cancelled" if outcome == "cancel" else "failed"
            )
            assert stored.active_embedding_generation_id is None
        assert (
            len(
                (
                    await session.scalars(
                        select(KnowledgeChunk).where(
                            KnowledgeChunk.document_id == doc
                        )
                    )
                ).all()
            )
            == 3
        )
        audit = (
            await session.scalars(
                select(ReembeddingAudit.action).where(
                    ReembeddingAudit.job_id == job_id
                )
            )
        ).all()
        assert set(audit) == {"requested", current.status}
