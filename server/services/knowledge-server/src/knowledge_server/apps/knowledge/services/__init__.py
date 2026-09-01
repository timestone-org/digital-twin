"""知识库的六层能力（ADR-0029 的三件套：ports + registry + 实现目录），
以及跨层的读写编排。

⚠ **跨功能只走这一层的再导出面。** 结构闸只判 import 路径的第 4 段是不是
`services`，别的功能包直接 import 子包它一声不吭——这条只能靠评审，
所以这份清单要短、要有注释说清它是唯一入口。

六层是**能力分层，不是执行流水线**：摄取那条链顺序穿过前五层，但检索只穿过
后两层，而 `agentic` 策略会反复重入 `indexing/`。
"""

from knowledge_server.apps.knowledge.services.capability import capability_of

__all__ = ["capability_of"]
