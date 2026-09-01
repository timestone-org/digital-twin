"""向量 + 关键词，按名次融合。默认那一路。

⚠ 两路缺一不可。向量那一路答的是「意思像」，关键词那一路答的是「就是这个词」：
工业资料里「K1 机组」「GB/T 4728」这类**编号与型号**在向量空间里几乎没有区分度，
而「怎么判断轴承要换了」这类问法一个关键词都对不上。

⚠ 没接嵌入档时**退成只走关键词**，并把这件事写进 `note`。这不是「悄悄退化」：
悄悄退化指的是**不告诉任何人**，而这里如实说了——关键词那一路本来就不需要
嵌入，为了一句「不可用」把它也关掉才是真损失。
"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.services.embedding import Embedder
from knowledge_server.apps.knowledge.services.indexing import (
    IndexPair,
    KeywordQuery,
    VectorQuery,
)
from knowledge_server.apps.knowledge.services.retrieval.hydrate import (
    hydrated,
)
from knowledge_server.apps.knowledge.services.retrieval.naive import (
    LANE_WIDTH,
)
from knowledge_server.apps.knowledge.services.retrieval.ports import (
    RetrievalRequest,
    RetrievalResult,
    fused,
)

HYBRID = "hybrid"

NO_EMBEDDING_NOTE = "这套部署没接嵌入档，本次只走了关键词那一路"


@dataclass(frozen=True)
class Hybrid:
    """两路各召一批，按名次融合。"""

    indexes: IndexPair
    embedder: Embedder
    name: str = HYBRID
    is_llm_backed: bool = False

    async def retrieve(
        self, session: AsyncSession, request: RetrievalRequest
    ) -> RetrievalResult:
        """两路各召一批再融。

        Args: session, request。
        """
        width = request.limit * LANE_WIDTH
        lanes: dict[str, list[tuple[object, str]]] = {}
        note = ""
        if self.embedder.can_embed:
            probe = (await self.embedder.embed([request.query]))[0]
            found = await self.indexes.vector.search(
                session,
                VectorQuery(base_id=request.base_id, vector=probe, limit=width),
            )
            lanes["vector"] = [(one.chunk_id, one.why) for one in found]
        else:
            note = NO_EMBEDDING_NOTE
        words = await self.indexes.keyword.search(
            session,
            KeywordQuery(
                base_id=request.base_id, text=request.query, limit=width
            ),
        )
        lanes["keyword"] = [(one.chunk_id, one.why) for one in words]
        ranked = fused(lanes)  # pyright: ignore[reportArgumentType]
        return RetrievalResult(
            hits=await hydrated(session, ranked, request.limit),
            strategy=self.name,
            note=note,
        )
