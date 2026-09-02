"""知识库的六层能力（ADR-0029 的三件套：ports + registry + 实现目录），
以及跨层的读写编排。

⚠ **跨功能只走这一层的再导出面。** 结构闸只判 import 路径的第 4 段是不是
`services`，别的功能包直接 import 子包它一声不吭——这条只能靠评审，
所以这份清单要短、要有注释说清它是唯一入口。

六层是**能力分层，不是执行流水线**：摄取那条链顺序穿过前五层，但检索只穿过
后两层，而 `agentic` 策略会反复重入 `indexing/`。
"""

from knowledge_server.apps.knowledge.errors import (
    KnowledgeBaseNotFound,
    RetrievalUnavailable,
)
from knowledge_server.apps.knowledge.schemas import HitOut, SearchIn, SearchOut
from knowledge_server.apps.knowledge.services import (
    chunk_service,
    library_service,
    search_service,
)
from knowledge_server.apps.knowledge.services.capability import capability_of

# ⚠ 下面这几样是给**对话模块**用的公开面：它调检索、列库、看块，还要认得
# 检索面会抛的两种错与出入参的形状。多露一样就是多一条它能伸进来的路
__all__ = [
    "HitOut",
    "KnowledgeBaseNotFound",
    "RetrievalUnavailable",
    "SearchIn",
    "SearchOut",
    "capability_of",
    "chunk_service",
    "library_service",
    "search_service",
]
