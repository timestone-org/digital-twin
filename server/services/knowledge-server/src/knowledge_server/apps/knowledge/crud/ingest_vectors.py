"""单文档暂存向量与活动索引之间的事务内发布。"""

import uuid
from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.crud.vector_format import literal


async def stage(
    session: AsyncSession,
    document: uuid.UUID,
    attempt: uuid.UUID,
    first: int,
    vectors: Sequence[list[float]],
) -> None:
    """以原文序号暂存本批向量。

    Args: session, document, attempt, first, vectors。
    """
    await session.execute(
        text("""
        INSERT INTO knowledge.kb_ingest_vectors
            (document_id,attempt,ordinal,embedding)
        VALUES(:doc,:attempt,:ordinal,CAST(:vector AS knowledge.vector))
    """),
        [
            {
                "doc": document,
                "attempt": attempt,
                "ordinal": first + n,
                "vector": literal(v),
            }
            for n, v in enumerate(vectors)
        ],
    )


async def has_legacy_vectors(session: AsyncSession, base: uuid.UUID) -> bool:
    """检查是否存在来源未认证的原索引。

    Args: session, base。
    """
    return bool(
        await session.scalar(
            text("""SELECT EXISTS(
        SELECT FROM knowledge.kb_chunk_embeddings WHERE base_id=:base
    )"""),
            {"base": base},
        )
    )


async def write_staged_vectors(
    session: AsyncSession,
    base: uuid.UUID,
    document: uuid.UUID,
    attempt: uuid.UUID,
    target: tuple[uuid.UUID | None, str],
) -> int:
    """按原文序号连接新块并把向量写入活动代次。

    Args: session, base, document, attempt, target。
    """
    generation, tag = target
    if generation is None:
        op = text("""
          WITH copied AS (
            INSERT INTO knowledge.kb_chunk_embeddings
                (chunk_id,base_id,embedding,embedding_model)
            SELECT c.id,c.base_id,s.embedding,:tag
            FROM knowledge.kb_chunks c JOIN knowledge.kb_ingest_vectors s
              ON c.document_id=s.document_id AND c.ordinal=s.ordinal
            WHERE c.document_id=:doc AND c.base_id=:base AND s.attempt=:attempt
            RETURNING 1
          ) SELECT count(*) FROM copied
        """)
    else:
        op = text("""
          WITH copied AS (
            INSERT INTO knowledge.kb_generation_embeddings
                (generation_id,chunk_id,embedding)
            SELECT :generation,c.id,s.embedding
            FROM knowledge.kb_chunks c JOIN knowledge.kb_ingest_vectors s
              ON c.document_id=s.document_id AND c.ordinal=s.ordinal
            WHERE c.document_id=:doc AND c.base_id=:base AND s.attempt=:attempt
            RETURNING 1
          ) SELECT count(*) FROM copied
        """)
    n = await session.scalar(
        op,
        {
            "base": base,
            "doc": document,
            "attempt": attempt,
            "tag": tag,
            "generation": generation,
        },
    )
    return int(n or 0)


async def discard(
    session: AsyncSession, document: uuid.UUID, attempt: uuid.UUID
) -> None:
    """仅清理本轮暂存。

    Args: session, document, attempt。
    """
    await session.execute(
        text(
            "DELETE FROM knowledge.kb_ingest_vectors "
            "WHERE document_id=:doc AND attempt=:attempt"
        ),
        {"doc": document, "attempt": attempt},
    )
