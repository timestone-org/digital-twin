"""本模块的表。

⚠ 每张表都要在这里再导出：迁移的 `env.py` 认的是 `Base.metadata`，
而漏 import 的那张表在 autogenerate 眼里是「该删掉的多余表」。
"""

from knowledge_server.apps.knowledge.models.base import Base
from knowledge_server.apps.knowledge.models.chunk import KnowledgeChunk
from knowledge_server.apps.knowledge.models.chunk_vector import (
    KnowledgeChunkVector,
)
from knowledge_server.apps.knowledge.models.document import KnowledgeDocument
from knowledge_server.apps.knowledge.models.knowledge_base import KnowledgeBase
from knowledge_server.apps.knowledge.models.source import KnowledgeSource

__all__ = [
    "Base",
    "KnowledgeBase",
    "KnowledgeChunk",
    "KnowledgeChunkVector",
    "KnowledgeDocument",
    "KnowledgeSource",
]
