"""这套部署走哪一档索引——只有一档（ADR-0045）。

⚠ 两路各只有一个实现，且**都是硬依赖**：`vector` 与 `pg_trgm` 由迁移装，
装不上迁移就失败，而迁移是整栈的前置作业。留回退档的代价是它与真检索在界面上
长得一模一样，只是召回悄悄变差——而没有人会去查一件没人说过的事。

⚠ 这一层留着的理由不再是「挑哪一档」，而是「装配只此一处」：写侧（摄取）与
读侧（检索）拿到的必须是同一对索引，各造各的话，两边的维数与表名可以漂开。
"""

from dataclasses import dataclass

from knowledge_server.apps.knowledge.services.indexing.keywords import (
    TRGM,
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

# 装了哪几路。⚠ 留着这两个元组是给能力面与契约用例用的：它们回答的是
# 「这套部署的检索由哪两路组成」，而那句话要在界面上说得出来
VECTOR_INDEXES: tuple[str, ...] = (PGVECTOR,)
KEYWORD_INDEXES: tuple[str, ...] = (TRGM,)


@dataclass(frozen=True)
class IndexPair:
    """这一次检索用的两路索引。"""

    vector: VectorIndex
    keyword: KeywordIndex


def build_indexes(dimensions: int) -> IndexPair:
    """装出两路索引。

    Args: dimensions（库上那一列的维数，见 `KNOWLEDGE_EMBEDDING_DIMENSIONS`）。
    """
    return IndexPair(
        vector=PgVectorIndex(dimensions=dimensions),
        keyword=TrgmKeywordIndex(),
    )
