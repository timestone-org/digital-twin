"""点位语义索引的 SQL 读写；所有外部值经绑定参数传递。"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

BATCH_SIZE = 32
CANDIDATE_LIMIT = 40

_CATALOG = """
WITH catalog AS (
 SELECT p.id, p.source_id, p.code, p.name, p.description, p.unit,
        s.name AS source_name, s.is_enabled,
        p.source_id::text || ':' || p.code AS node_key,
        concat_ws(E'\\n', p.code, p.name, p.description, s.name,
 s.description, p.unit) AS content,
        md5(concat_ws(E'\\n', p.code, p.name, p.description, s.name,
 s.description, p.unit)) AS content_hash
 FROM platform.collect_points p
 JOIN platform.collect_sources s ON s.id = p.source_id
)
"""

_PENDING = text(
    "".join(
        (
            _CATALOG,
            """
SELECT c.id, c.content_hash, c.content
FROM catalog c LEFT JOIN platform.collect_point_embeddings e ON e.point_id
 = c.id
WHERE (e.point_id IS NULL OR e.content_hash <> c.content_hash
 OR e.model_signature <> :signature OR e.embedding IS NULL)
 AND (e.updated_at IS NULL OR e.content_hash <> c.content_hash
 OR e.model_signature <> :signature OR e.embedding IS NOT NULL
 OR e.updated_at < now() - interval '60 seconds')
ORDER BY e.updated_at NULLS FIRST, c.id LIMIT :limit
""",
        )
    )
)

_SAVE = text(
    "".join(
        (
            _CATALOG,
            """
INSERT INTO platform.collect_point_embeddings (point_id, content_hash,
 model_signature, embedding)
SELECT id, content_hash, :signature, CAST(:embedding AS double precision[])
FROM catalog WHERE id = :point_id AND content_hash = :content_hash
ON CONFLICT (point_id) DO UPDATE SET content_hash = EXCLUDED.content_hash,
 model_signature = EXCLUDED.model_signature, embedding =
 EXCLUDED.embedding, updated_at = now()
WHERE EXCLUDED.embedding IS NOT NULL
 OR platform.collect_point_embeddings.embedding IS NULL
 OR platform.collect_point_embeddings.content_hash <> EXCLUDED.content_hash
 OR platform.collect_point_embeddings.model_signature <>
 EXCLUDED.model_signature
""",
        )
    )
)

_SEARCH = text(
    "".join(
        (
            _CATALOG,
            """
, current_points AS (
 SELECT c.*, e.embedding,
        (e.content_hash = c.content_hash AND e.model_signature = :signature
 AND e.embedding IS NOT NULL) AS is_indexed
 FROM catalog c LEFT JOIN platform.collect_point_embeddings e ON e.point_id
 = c.id
 WHERE CAST(:source_id AS uuid) IS NULL OR c.source_id = CAST(:source_id AS
 uuid)
), lexical AS (
 SELECT id, row_number() OVER (ORDER BY (lower(code) = lower(:query)) DESC,
 id) AS rank
 FROM current_points WHERE strpos(lower(content), lower(:query)) > 0
 ORDER BY rank LIMIT :candidates
), semantic AS (
 SELECT id, row_number() OVER (ORDER BY similarity DESC, id) AS rank
 FROM (
  SELECT id, (SELECT sum(a * b) FROM unnest(embedding, CAST(:probe AS
 double precision[])) AS v(a,b)) AS similarity
  FROM current_points WHERE is_indexed AND CAST(:probe AS double
 precision[]) IS NOT NULL
 AND cardinality(embedding) = cardinality(CAST(:probe AS double precision[]))
 ) scored WHERE similarity >= 0.35
 ORDER BY rank LIMIT :candidates
), ranked AS (
 SELECT id, sum(1.0 / (60 + rank)) AS score FROM (
  SELECT * FROM lexical UNION ALL SELECT * FROM semantic
 ) both_lanes GROUP BY id
)
SELECT c.id, c.source_id, c.node_key, c.code, c.name, c.description, c.unit,
 c.source_name, c.is_enabled, (lower(c.code) = lower(:query)) AS is_exact,
 r.score, (SELECT count(*) FROM current_points WHERE NOT
 coalesce(is_indexed, false)) AS pending_count
FROM ranked r JOIN current_points c ON c.id = r.id
ORDER BY is_exact DESC, r.score DESC, c.id LIMIT :limit
""",
        )
    )
)

_PENDING_COUNT = text(
    "".join(
        (
            _CATALOG,
            """
SELECT count(*) FROM catalog c LEFT JOIN platform.collect_point_embeddings
 e ON e.point_id = c.id
WHERE (CAST(:source_id AS uuid) IS NULL OR c.source_id = CAST(:source_id AS
 uuid))
AND (e.point_id IS NULL OR e.content_hash <> c.content_hash OR
 e.model_signature <> :signature OR e.embedding IS NULL)
""",
        )
    )
)


@dataclass(frozen=True)
class PendingPoint:
    """一份脱离事务的待嵌入文本。"""

    point_id: uuid.UUID
    content_hash: str
    content: str


async def pending(session: AsyncSession, signature: str) -> list[PendingPoint]:
    """取有界待处理批次。Args: session, signature。"""
    rows = await session.execute(
        _PENDING, {"signature": signature, "limit": BATCH_SIZE}
    )
    return [PendingPoint(row.id, row.content_hash, row.content) for row in rows]


async def save(
    session: AsyncSession,
    item: PendingPoint,
    signature: str,
    vector: list[float] | None,
) -> None:
    """只写仍与当前配置一致的结果。Args: session, item, signature, vector。"""
    await save_many(session, [item], signature, [vector])


async def save_many(
    session: AsyncSession,
    items: Sequence[PendingPoint],
    signature: str,
    vectors: Sequence[list[float] | None],
) -> None:
    """批量写入仍有效的嵌入结果。Args: session, items, signature, vectors。"""
    if not items:
        return
    await session.execute(
        _SAVE,
        [
            {
                "point_id": item.point_id,
                "content_hash": item.content_hash,
                "signature": signature,
                "embedding": vector,
            }
            for item, vector in zip(items, vectors, strict=True)
        ],
    )


async def search(
    session: AsyncSession, parameters: dict[str, object]
) -> tuple[list[dict[str, object]], int]:
    """合并精确、关键词和语义召回。Args: session, parameters。"""
    rows = await session.execute(
        _SEARCH, {**parameters, "candidates": CANDIDATE_LIMIT}
    )
    found = [dict(row) for row in rows.mappings()]
    count = await session.scalar(_PENDING_COUNT, parameters)
    return found, int(count or 0)
