"""单次向量召回。基线，也是出问题时的对照组。

⚠ 留着它**不是为了用**：出了「召回变差」的报告时，没有基线就只能靠感觉。
默认那一路是 `hybrid`。
"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.services.embedding import Embedder
from knowledge_server.apps.knowledge.services.indexing import (
    IndexPair,
    VectorQuery,
)
from knowledge_server.apps.knowledge.services.retrieval.hydrate import (
    hydrated,
)
from knowledge_server.apps.knowledge.services.retrieval.ports import (
    Fused,
    RetrievalRequest,
    RetrievalResult,
    RetrievalUnavailable,
)

NAIVE = "naive"

# 送进融合之前每一路各取多少条。⚠ 比最终 limit 大一截：只取 limit 条的话，
# 融合就没什么可融的了——两路各自的第 limit+1 条本来可能是最好的那一条
LANE_WIDTH = 4


@dataclass(frozen=True)
class NaiveVector:
    """把问题嵌一次，取最近的几条。"""

    indexes: IndexPair
    embedder: Embedder
    name: str = NAIVE
    is_llm_backed: bool = False
    # 只召回不作答：答案由调用方自己写（助手、或人）
    is_answering: bool = False

    async def retrieve(
        self, session: AsyncSession, request: RetrievalRequest
    ) -> RetrievalResult:
        """嵌一次问题，向量召回。

        ⚠ 没接嵌入档时**抛**而不是回空表：空表与「确实没有相关内容」长得
        一模一样，而模型会把它读成「查过了，没有」然后接着往下走。

        Args: session, request。
        """
        if not self.embedder.can_embed:
            raise RetrievalUnavailable("这个库还没建索引：这套部署没接嵌入档")
        probe = (await self.embedder.embed([request.query]))[0]
        scored = await self.indexes.vector.search(
            session,
            VectorQuery(
                base_id=request.base_id,
                vector=probe,
                limit=request.limit * LANE_WIDTH,
            ),
        )
        ranked = [
            Fused(chunk_id=one.chunk_id, score=one.score, reasons=(one.why,))
            for one in scored
        ]
        return RetrievalResult(
            hits=await hydrated(session, ranked, request.limit),
            strategy=self.name,
        )
