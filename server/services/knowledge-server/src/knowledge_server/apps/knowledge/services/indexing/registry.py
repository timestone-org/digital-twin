"""这套部署此刻走哪一档索引。

⚠ 装了哪几路是**显式元组**，而挑哪一路按**启动时的探测**（ADR-0034 决策四）：
配置说的是「想用哪一档」，探测说的是「此刻真能用哪一档」，两者不一致时以
探测为准，并把原因如实报进 `/capabilities`。

⚠ 配置强制加速档而库里没有时**仍然回退**，不抛：这一档只是加速，正确性不
依赖它——抛的话服务起不来，而检索本来还能用。
"""

from dataclasses import dataclass

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
    PgVectorIndex,
)
from knowledge_server.apps.knowledge.services.indexing.ports import (
    KeywordIndex,
    VectorIndex,
)

# 装了哪几路。⚠ 顺序即优先级：第一路是探测通过时的首选
VECTOR_INDEXES: tuple[str, ...] = (PGVECTOR, BRUTEFORCE)
KEYWORD_INDEXES: tuple[str, ...] = (TRGM, LIKE)


@dataclass(frozen=True)
class IndexPair:
    """这一次检索用的两路索引。"""

    vector: VectorIndex
    keyword: KeywordIndex


def build_indexes(vector_lane: str, keyword_lane: str) -> IndexPair:
    """按已经判定好的档位名装出两路索引。

    ⚠ 判定不在这里做：判定要看配置**与**探测两样，而那是能力面那一层的事
    （`services/capability.py`）。两处各判一遍的话，`/capabilities` 报的与
    实际走的可以漂开——而那时账单与延迟是唯一的迹象。

    Args: vector_lane, keyword_lane。
    """
    fallback = BruteForceIndex()
    vector: VectorIndex = (
        PgVectorIndex(fallback=fallback)
        if vector_lane == PGVECTOR
        else fallback
    )
    keyword: KeywordIndex = (
        TrgmKeywordIndex() if keyword_lane == TRGM else LikeKeywordIndex()
    )
    return IndexPair(vector=vector, keyword=keyword)
