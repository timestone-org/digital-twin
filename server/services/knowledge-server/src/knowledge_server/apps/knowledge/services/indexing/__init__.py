"""层 5 索引：向量与关键词各存哪、各怎么查。

⚠ 两路都是**硬依赖**，没有回退档（ADR-0045）：向量在 `vector` 列上走 HNSW，
关键词在 `pg_trgm` 上走 trigram，两个扩展都由迁移装。

⚠ 打分**只排序不取舍**，并把「为什么它排在这」（`why`）一并交出去：
得分为 0 的候选一律不返回。硬凑几条出来的话，模型会以为「就这些了」然后从
里面挑一条——那比返回空表难查得多（与点位召回同源）。
"""

from knowledge_server.apps.knowledge.services.indexing.keywords import (
    TRGM,
    TrgmKeywordIndex,
)
from knowledge_server.apps.knowledge.services.indexing.pgvector import (
    PGVECTOR,
    VECTOR_TABLE,
    PgVectorIndex,
    VectorDimensionMismatch,
)
from knowledge_server.apps.knowledge.services.indexing.ports import (
    KeywordIndex,
    KeywordQuery,
    Scored,
    VectorIndex,
    VectorQuery,
    VectorRows,
    ranked,
)
from knowledge_server.apps.knowledge.services.indexing.registry import (
    KEYWORD_INDEXES,
    VECTOR_INDEXES,
    IndexPair,
    build_indexes,
)

__all__ = [
    "KEYWORD_INDEXES",
    "PGVECTOR",
    "TRGM",
    "VECTOR_INDEXES",
    "VECTOR_TABLE",
    "IndexPair",
    "KeywordIndex",
    "KeywordQuery",
    "PgVectorIndex",
    "Scored",
    "TrgmKeywordIndex",
    "VectorDimensionMismatch",
    "VectorIndex",
    "VectorQuery",
    "VectorRows",
    "build_indexes",
    "ranked",
]
