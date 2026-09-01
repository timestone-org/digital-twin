"""层 5 索引：向量与关键词各存哪、各怎么查。"""

from knowledge_server.apps.knowledge.services.indexing.bruteforce import (
    BRUTEFORCE,
    BruteForceIndex,
)
from knowledge_server.apps.knowledge.services.indexing.keywords import (
    LIKE,
    TRGM,
    LikeKeywordIndex,
    TrgmKeywordIndex,
)
from knowledge_server.apps.knowledge.services.indexing.pgvector import (
    PGVECTOR,
    VECTOR_TABLE,
    PgVectorIndex,
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
    "BRUTEFORCE",
    "KEYWORD_INDEXES",
    "LIKE",
    "PGVECTOR",
    "TRGM",
    "VECTOR_INDEXES",
    "VECTOR_TABLE",
    "BruteForceIndex",
    "IndexPair",
    "KeywordIndex",
    "KeywordQuery",
    "LikeKeywordIndex",
    "PgVectorIndex",
    "Scored",
    "TrgmKeywordIndex",
    "VectorIndex",
    "VectorQuery",
    "VectorRows",
    "build_indexes",
    "ranked",
]
