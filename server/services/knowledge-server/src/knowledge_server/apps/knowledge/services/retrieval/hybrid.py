"""向量 + 关键词，按名次融合。默认那一路。

⚠ 两路缺一不可。向量那一路答的是「意思像」，关键词那一路答的是「就是这个词」：
工业资料里「K1 机组」「GB/T 4728」这类**编号与型号**在向量空间里几乎没有区分度，
而「怎么判断轴承要换了」这类问法一个关键词都对不上。

⚠ 没接嵌入档时**退成只走关键词**，并把这件事写进 `note`。这不是「悄悄退化」：
悄悄退化指的是**不告诉任何人**，而这里如实说了——关键词那一路本来就不需要
嵌入，为了一句「不可用」把它也关掉才是真损失。

⚠ 接了重排就**多召一批再排**（ADR-0042）：只召 limit 条的话，重排能做的只有
把这几条换个顺序，而它真正的价值是把融合名次里排在 limit 之外、其实最相关的
那一条捞上来。重排排不成时退回融合名次，并如实标注这次没排。
"""

from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.services.embedding import Embedder
from knowledge_server.apps.knowledge.services.indexing import (
    IndexPair,
    KeywordQuery,
    VectorQuery,
)
from knowledge_server.apps.knowledge.services.reranking import (
    NullReranker,
    Reranker,
)
from knowledge_server.apps.knowledge.services.retrieval.hydrate import (
    hydrated,
)
from knowledge_server.apps.knowledge.services.retrieval.naive import (
    LANE_WIDTH,
)
from knowledge_server.apps.knowledge.services.retrieval.ports import (
    Fused,
    RetrievalRequest,
    RetrievalResult,
    fused,
)
from knowledge_server.apps.knowledge.services.retrieval.reranked import (
    candidate_width,
    reranked,
)

HYBRID = "hybrid"

NO_EMBEDDING_NOTE = "这套部署没接嵌入档，本次只走了关键词那一路"


@dataclass(frozen=True)
class Hybrid:
    """两路各召一批，按名次融合，接了重排就再排一次。"""

    indexes: IndexPair
    embedder: Embedder
    # 重排那一路。⚠ 没接时给 `NullReranker` 而不是 `None`：调用点于是不必写
    # 「这一路在不在」的分支，而缺席由 `can_rerank` 如实说出来
    reranker: Reranker = field(default_factory=NullReranker)
    name: str = HYBRID
    is_llm_backed: bool = False
    # 只召回不作答：答案由调用方自己写（助手、或人）
    is_answering: bool = False

    async def retrieve(
        self, session: AsyncSession, request: RetrievalRequest
    ) -> RetrievalResult:
        """两路各召一批再融，接了重排就把候选多召一批再重排。

        Args: session, request。
        """
        ranked, note = await self._fused(session, request)
        # ⚠ 接了重排才多召一批：不接时多召的那几条只会被原样丢掉，
        # 而补出处那一步是要打库的
        wanted = (
            candidate_width(request.limit)
            if self.reranker.can_rerank
            else request.limit
        )
        candidates = await hydrated(session, ranked, wanted)
        hits, rerank_note = await reranked(
            self.reranker, request.query, candidates, request.limit
        )
        return RetrievalResult(
            hits=hits,
            strategy=self.name,
            note="；".join(one for one in (note, rerank_note) if one),
        )

    async def _fused(
        self, session: AsyncSession, request: RetrievalRequest
    ) -> tuple[list[Fused], str]:
        """两路各召一批再按名次融合，并回一句「这次少走了哪一路」。

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
        return (fused(lanes), note)  # pyright: ignore[reportArgumentType]
