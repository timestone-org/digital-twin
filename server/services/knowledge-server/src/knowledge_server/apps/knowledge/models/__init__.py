"""本模块的表。

⚠ 每张表都要在这里再导出：迁移的 `env.py` 认的是 `knowledge_server.orm.Base`
的 metadata，而漏 import 的那张表在 autogenerate 眼里是「该删掉的多余表」。

⚠ 块向量那张表**没有 ORM 模型**：它的 `vector(N)` 列没有对应的 SQLAlchemy
类型（不引第三方包的话），读写都在 `services/indexing/pgvector.py` 里走裸 SQL。
"""

from knowledge_server.apps.knowledge.models.chunk import KnowledgeChunk
from knowledge_server.apps.knowledge.models.document import KnowledgeDocument
from knowledge_server.apps.knowledge.models.knowledge_base import KnowledgeBase
from knowledge_server.apps.knowledge.models.source import KnowledgeSource

__all__ = [
    "KnowledgeBase",
    "KnowledgeChunk",
    "KnowledgeDocument",
    "KnowledgeSource",
]
