"""回退档：向量存 bytea，余弦在应用层算。

这一路是**持久真相**（ADR-0034 决策二）：任何环境都有它，pgvector 那一路只是
可选的加速物化。所以加速档在写的时候两边都写，而这一路只写自己这一张表。

⚠ 它是**全表扫描**：先按库收窄，再把那个库的全部向量取回来算余弦。几千块
还行，几万块起就是「检索越来越慢」——而它不会报任何错。所以能装加速档就装。

⚠ 维数对不上的行**直接跳过**而不是让整次检索失败：换过嵌入档的库里两种维数
会并存，一条读不了的旧记录不该让整次检索炸——它只该排不上去。
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.models import KnowledgeChunkVector
from knowledge_server.apps.knowledge.services.indexing.ports import (
    Scored,
    VectorQuery,
    VectorRows,
    ranked,
)
from lib import vectors
from lib.logging import get_logger

_logger = get_logger("knowledge.indexing")

BRUTEFORCE = "bruteforce"


@dataclass(frozen=True)
class BruteForceIndex:
    """bytea + 应用层余弦。"""

    name: str = BRUTEFORCE

    async def upsert(self, session: AsyncSession, rows: VectorRows) -> None:
        """先删掉这些块的旧向量，再整批插新的。

        ⚠ 先删再插而不是 upsert：一个块只有一条向量，而「删了再插」在这一层
        比 `ON CONFLICT` 好读——冲突键是唯一索引不是主键，写错索引名的话
        `ON CONFLICT` 会静默变成普通插入，于是同一个块攒出两条向量。

        Args: session, rows。
        """
        if not rows.rows:
            return
        chunk_ids = [one for one, _vector in rows.rows]
        await session.execute(
            delete(KnowledgeChunkVector).where(
                KnowledgeChunkVector.chunk_id.in_(chunk_ids)
            )
        )
        session.add_all(
            [
                KnowledgeChunkVector(
                    base_id=rows.base_id,
                    chunk_id=chunk_id,
                    embedding=vectors.encode(vector),
                    embedding_model=rows.model,
                    dimensions=rows.dimensions,
                )
                for chunk_id, vector in rows.rows
            ]
        )
        await session.flush()

    async def search(
        self, session: AsyncSession, query: VectorQuery
    ) -> list[Scored]:
        """把这个库的全部向量取回来算余弦。

        Args: session, query。
        """
        found = await session.execute(
            select(
                KnowledgeChunkVector.chunk_id,
                KnowledgeChunkVector.embedding,
                KnowledgeChunkVector.dimensions,
            ).where(KnowledgeChunkVector.base_id == query.base_id)
        )
        wanted = len(query.vector)
        scored: list[Scored] = []
        for chunk_id, raw, dimensions in found.all():
            if dimensions != wanted:
                continue
            scored.append(
                _scored(chunk_id, vectors.cosine(query.vector, _decoded(raw)))
            )
        return ranked(scored, query.limit)


def _decoded(raw: bytes) -> list[float]:
    """把字节还原成一条向量；坏了就当零向量。

    ⚠ 坏一条不让整次检索失败：`decode` 在长度对不上时抛，而那条记录只该
    排不上去。真要查是哪一条，日志里有。

    Args: raw。
    """
    try:
        return vectors.decode(raw)
    except vectors.VectorCorrupt as error:
        _logger.warning(
            "vector_corrupt", "一条向量读不出来，已跳过", error=error
        )
        return []


def _scored(chunk_id: uuid.UUID, score: float) -> Scored:
    return Scored(chunk_id=chunk_id, score=score, why=f"余弦 {score:.3f}")
