"""逐批核验实际模型回答，确认后才整体替换一份文档的已发布块。"""

import uuid
from collections.abc import AsyncGenerator, Callable, Sequence
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.crud import ingest_vectors as vectors
from knowledge_server.apps.knowledge.crud import reembedding as jobs
from knowledge_server.apps.knowledge.models import (
    KnowledgeBase,
    KnowledgeChunk,
    KnowledgeDocument,
)
from knowledge_server.apps.knowledge.services import ingest_figures
from knowledge_server.apps.knowledge.services.chunking import Chunk
from knowledge_server.apps.knowledge.services.embedding import (
    Embedder,
    EmbeddingSpace,
    EmbeddingUnavailable,
    SnapshotEmbedder,
    space,
)
from knowledge_server.apps.knowledge.services.embedding.space import model_label
from lib.logging import get_logger
from lib.utils.ids import uuid7

Sessions = Callable[[], AbstractAsyncContextManager[AsyncSession]]
_logger = get_logger("knowledge.ingest")


@dataclass(frozen=True)
class Source:
    base: uuid.UUID
    document: uuid.UUID
    generation: uuid.UUID | None


@dataclass(frozen=True)
class Batch:
    source: Source
    attempt: uuid.UUID
    expected: EmbeddingSpace


async def _authorized(
    session: AsyncSession, source: Source, embedder: Embedder
) -> tuple[KnowledgeBase, SnapshotEmbedder]:
    base = await jobs.lock_base(session, source.base)
    if base is None:
        raise EmbeddingUnavailable("知识库已删除")
    bound = space.for_base(base, embedder)
    if base.embedding_space_id:
        if bound is None:
            raise EmbeddingUnavailable(space.MISMATCH)
        return base, bound
    current = space.current(embedder)
    if current is None or not isinstance(embedder, SnapshotEmbedder):
        raise EmbeddingUnavailable(space.NO_MODEL)
    if await vectors.has_legacy_vectors(session, base.id):
        raise EmbeddingUnavailable(space.UNVERIFIED)
    if base.embedding_model is not None and (
        base.embedding_model != model_label(current.model)
        or base.dimensions != current.dimensions
    ):
        raise EmbeddingUnavailable(space.MISMATCH)
    return base, embedder


@asynccontextmanager
async def verified(
    sessions: Sessions,
    source: Source,
    embedder: Embedder,
    chunks: Sequence[Chunk],
    size: int,
) -> AsyncGenerator[Batch]:
    """先计算并隔离存储全部向量。

    Args: sessions, source, embedder, chunks, size。
    """
    async with sessions() as session:
        _, actual = await _authorized(session, source, embedder)
        expected = actual.space
        if expected is None:
            raise EmbeddingUnavailable(space.NO_MODEL)
        if expected.dimensions != await jobs.index_dimensions(session):
            raise EmbeddingUnavailable(
                "模型与数据库向量列的维数不符，已保留原文和可读索引"
            )
    batch = Batch(source, uuid7(), expected)
    try:
        for at in range(0, len(chunks), max(1, size)):
            group = chunks[at : at + max(1, size)]
            answer = await actual.embed_batch([one.text for one in group])
            if (
                answer.identity != expected.identity
                or answer.model != expected.model
                or len(answer.vectors) != len(group)
                or any(len(v) != expected.dimensions for v in answer.vectors)
            ):
                raise EmbeddingUnavailable(
                    "本次摄取的嵌入空间或向量形状已变，原索引保留"
                )
            async with sessions() as session:
                await vectors.stage(
                    session, source.document, batch.attempt, at, answer.vectors
                )
        yield batch
    finally:
        try:
            async with sessions() as session:
                await vectors.discard(session, source.document, batch.attempt)
        except Exception as error:
            _logger.warning(
                "ingest_vector_cleanup_failed",
                "暂存向量等待清理",
                reason=type(error).__name__,
            )


async def publish_document(
    session: AsyncSession,
    batch: Batch,
    embedder: Embedder,
    chunks: Sequence[Chunk],
    figures: ingest_figures.PreparedFigures,
) -> None:
    """在一个事务中公布完整文档和已核验向量。

    Args: session, batch, embedder, chunks, figures。
    """
    source = batch.source
    doc = await session.get(
        KnowledgeDocument,
        source.document,
        with_for_update=True,
        populate_existing=True,
    )
    if (
        doc is None
        or doc.ingest_generation != source.generation
        or doc.status != "embedding"
    ):
        raise EmbeddingUnavailable("文档已删除或已由新的摄取任务接管")
    base, actual = await _authorized(session, source, embedder)
    if actual.space != batch.expected:
        raise EmbeddingUnavailable(space.MISMATCH)
    await _replace_source(session, source, chunks, figures)
    count = await vectors.write_staged_vectors(
        session,
        source.base,
        source.document,
        batch.attempt,
        (
            base.active_embedding_generation_id,
            space.tag(batch.expected.identity),
        ),
    )
    if count != len(chunks):
        raise EmbeddingUnavailable("文档暂存向量不完整，原索引保留")
    base.embedding_space_id = batch.expected.identity
    base.embedding_model = model_label(batch.expected.model)
    base.dimensions = batch.expected.dimensions
    await crud.document.mark_ready(
        session, source.document, count, datetime.now(UTC)
    )


async def defer(
    session: AsyncSession,
    source: Source,
    chunks: Sequence[Chunk],
    figures: ingest_figures.PreparedFigures,
    reason: str,
) -> None:
    """保留上次可读块，首次解析的原文可用于后续整库重嵌。

    Args: session, source, chunks, figures, reason。"""
    doc = await session.get(
        KnowledgeDocument,
        source.document,
        with_for_update=True,
        populate_existing=True,
    )
    if (
        doc is None
        or doc.ingest_generation != source.generation
        or doc.status != "embedding"
    ):
        return
    count = await session.scalar(
        select(func.count())
        .select_from(KnowledgeChunk)
        .where(KnowledgeChunk.document_id == doc.id)
    )
    if not count:
        count = await _replace_source(session, source, chunks, figures)
    doc.chunk_count = count
    doc.embedding_deferred = True
    doc.status = "failed"
    doc.failure_reason = reason


async def _replace_source(
    session: AsyncSession,
    source: Source,
    chunks: Sequence[Chunk],
    figures: ingest_figures.PreparedFigures,
) -> int:
    """一起发布块和图文关联。Args: session, source, chunks, figures。"""
    ids = await ingest_figures.persist_figures(
        session, (source.base, source.document), figures
    )
    chunk_ids = await crud.chunk.replace_chunks(
        session, source.base, source.document, chunks
    )
    await crud.figure.link_figures(
        session, ingest_figures.links_of(chunks, chunk_ids, ids)
    )
    return len(chunk_ids)
