"""用实际查询批次的空间读取已发布索引，换档时明确拒绝向量召回。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.models import KnowledgeBase
from knowledge_server.apps.knowledge.services.embedding import (
    Embedder,
    EmbeddingUnavailable,
    SnapshotEmbedder,
    space,
)
from knowledge_server.apps.knowledge.services.indexing import (
    IndexPair,
    Scored,
    VectorQuery,
)
from knowledge_server.apps.knowledge.services.released import released
from knowledge_server.apps.knowledge.services.retrieval.ports import (
    RetrievalRequest,
    RetrievalUnavailable,
)


async def retrieve_vectors(
    session: AsyncSession,
    request: RetrievalRequest,
    embedder: Embedder,
    indexes: IndexPair,
    limit: int,
) -> list[Scored]:
    """在查询返回后重新确认库的活动空间与代次。

    Args: session, request, embedder, indexes, limit。
    """
    base = await session.get(
        KnowledgeBase, request.base_id, populate_existing=True
    )
    if base is None:
        raise RetrievalUnavailable("知识库不存在")
    encoder = _encoder_for(base, embedder)
    expected = base.embedding_space_id
    await released(session)
    try:
        answer = await encoder.embed_batch([request.query])
    except EmbeddingUnavailable as error:
        raise RetrievalUnavailable(space.MISMATCH) from error
    if answer.identity != expected or len(answer.vectors) != 1:
        raise RetrievalUnavailable(space.MISMATCH)
    current = await session.scalar(
        select(KnowledgeBase)
        .where(KnowledgeBase.id == request.base_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    if (
        current is None
        or current.embedding_space_id != answer.identity
        or current.embedding_model != space.model_label(answer.model)
        or current.dimensions != len(answer.vectors[0])
    ):
        raise RetrievalUnavailable(space.MISMATCH)
    return await indexes.vector.search(
        session,
        VectorQuery(
            request.base_id,
            answer.vectors[0],
            limit,
            model_tag=space.tag(answer.identity),
            generation_id=current.active_embedding_generation_id,
        ),
    )


def _encoder_for(base: KnowledgeBase, embedder: Embedder) -> SnapshotEmbedder:
    """为当前库选出能够读取已发布空间的模型。Args: base, embedder。"""
    encoder = space.for_base(base, embedder)
    if encoder is None:
        status = space.status(base, embedder)
        note = space.NO_MODEL if not embedder.can_embed else space.NOTES[status]
        raise RetrievalUnavailable(note)
    return encoder
