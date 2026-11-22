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
from knowledge_server.apps.knowledge.crud import source_records
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
    content_revision: int


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
async def _attempt(
    sessions: Sessions, source: Source, embedder: Embedder
) -> AsyncGenerator[tuple[Batch, SnapshotEmbedder]]:
    async with sessions() as session:
        base, actual = await _authorized(session, source, embedder)
        expected = actual.space
        if expected is None:
            raise EmbeddingUnavailable(space.NO_MODEL)
        if expected.dimensions != await jobs.index_dimensions(session):
            raise EmbeddingUnavailable(
                "模型与数据库向量列的维数不符，已保留原文和可读索引"
            )
        batch = Batch(source, uuid7(), expected, base.content_revision or 0)
    try:
        yield batch, actual
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


async def _stage_group(
    sessions: Sessions,
    batch: Batch,
    encoder: SnapshotEmbedder,
    offset: int,
    texts: Sequence[str],
) -> None:
    answer = await encoder.embed_batch(texts)
    expected = batch.expected
    if (
        answer.identity != expected.identity
        or answer.model != expected.model
        or len(answer.vectors) != len(texts)
        or any(len(v) != expected.dimensions for v in answer.vectors)
    ):
        raise EmbeddingUnavailable(
            "本次摄取的嵌入空间或向量形状已变，原索引保留"
        )
    async with sessions() as session:
        await vectors.stage(
            session,
            batch.source.document,
            batch.attempt,
            offset,
            answer.vectors,
        )


@asynccontextmanager
async def verified(
    sessions: Sessions,
    source: Source,
    embedder: Embedder,
    chunks: Sequence[Chunk],
    size: int,
) -> AsyncGenerator[Batch]:
    """按批验证已解析的原文。Args: sessions, source, embedder, chunks, size。"""
    async with _attempt(sessions, source, embedder) as (batch, encoder):
        width = max(1, size)
        for at in range(0, len(chunks), width):
            await _stage_group(
                sessions,
                batch,
                encoder,
                at,
                [c.text for c in chunks[at : at + width]],
            )
        yield batch


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
    base, _ = await _publication_target(session, batch, embedder)
    await _replace_source(session, batch.source, chunks, figures)
    await _publish_index(session, batch, base, len(chunks))


async def _publication_target(
    session: AsyncSession, batch: Batch, embedder: Embedder
) -> tuple[KnowledgeBase, KnowledgeDocument]:
    source = batch.source
    base, actual = await _authorized(session, source, embedder)
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
        or doc.source_revision_state == "historical"
    ):
        raise EmbeddingUnavailable("文档已删除或已由新的摄取任务接管")
    if actual.space != batch.expected:
        raise EmbeddingUnavailable(space.MISMATCH)
    return base, doc


async def _publish_index(
    session: AsyncSession,
    batch: Batch,
    base: KnowledgeBase,
    expected_count: int,
) -> None:
    source = batch.source
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
    if count != expected_count:
        raise EmbeddingUnavailable("文档暂存向量不完整，原索引保留")
    base.embedding_space_id = batch.expected.identity
    base.embedding_model = model_label(batch.expected.model)
    base.dimensions = batch.expected.dimensions
    await crud.document.mark_ready(
        session, source.document, count, datetime.now(UTC)
    )
    if not await source_records.publish_ready(
        session, source.base, source.document
    ):
        raise EmbeddingUnavailable("来源原文正在修改，先保留当前版本")


async def defer(
    session: AsyncSession,
    source: Source,
    chunks: Sequence[Chunk],
    figures: ingest_figures.PreparedFigures,
    reason: str,
) -> None:
    """保留上次可读块，首次解析的原文可用于后续整库重嵌。

    Args: session, source, chunks, figures, reason。"""
    await jobs.lock_base(session, source.base)
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
        or doc.source_revision_state == "historical"
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


async def reindex_saved(
    sessions: Sessions,
    source: Source,
    embedder: Embedder,
    size: int,
    expected_count: int,
) -> None:
    """按原有块序号重算向量，保留块 UUID、图和引用。

    Args: sessions, source, embedder, size, expected_count。"""
    async with _attempt(sessions, source, embedder) as (batch, encoder):
        offset = 0
        while offset < expected_count:
            async with sessions() as session:
                rows = (
                    await session.execute(
                        select(KnowledgeChunk.ordinal, KnowledgeChunk.text)
                        .where(
                            KnowledgeChunk.document_id == source.document,
                            KnowledgeChunk.ordinal >= offset,
                        )
                        .order_by(KnowledgeChunk.ordinal)
                        .limit(min(max(1, size), expected_count - offset))
                    )
                ).all()
            if not rows:
                raise EmbeddingUnavailable("现有原文块不完整，已保留当前版本")
            if any(row.ordinal != offset + i for i, row in enumerate(rows)):
                raise EmbeddingUnavailable(
                    "现有原文块的序号不完整，已保留当前版本"
                )
            await _stage_group(
                sessions, batch, encoder, offset, [row.text for row in rows]
            )
            offset += len(rows)
        async with sessions() as session:
            base, document = await _publication_target(session, batch, embedder)
            if (
                offset != document.chunk_count
                or (base.content_revision or 0) != batch.content_revision
            ):
                raise EmbeddingUnavailable(
                    "原文在重建本版本时发生变化，请重新同步"
                )
            await _publish_index(session, batch, base, offset)


async def defer_saved(sessions: Sessions, source: Source, reason: str) -> None:
    """保留已存在的原文块并标记本次失败。Args: sessions, source, reason。"""
    async with sessions() as session:
        await jobs.lock_base(session, source.base)
        doc = await session.get(
            KnowledgeDocument,
            source.document,
            with_for_update=True,
            populate_existing=True,
        )
        if (
            doc is not None
            and doc.ingest_generation == source.generation
            and doc.status == "embedding"
            and doc.source_revision_state in ("pending", "current")
        ):
            doc.embedding_deferred = True
            doc.status = "failed"
            doc.failure_reason = reason
