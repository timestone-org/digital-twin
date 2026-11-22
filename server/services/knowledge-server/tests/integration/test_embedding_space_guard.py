"""请求向量仅与同源的活动索引比较。"""

import uuid

import pytest
from integration.test_reembedding_worker import (
    LocalEmbedder,
    Sessions,
    corpus,
    local_space,
    start_job,
    unchanged,
)

from knowledge_server.apps.knowledge.services.indexing import build_indexes
from knowledge_server.apps.knowledge.services.reembedding_worker import (
    ReembeddingSteps,
)
from knowledge_server.apps.knowledge.services.retrieval import (
    RetrievalRequest,
    RetrievalUnavailable,
)
from knowledge_server.apps.knowledge.services.retrieval.hybrid import Hybrid
from knowledge_server.apps.knowledge.services.retrieval.naive import NaiveVector

pytestmark = pytest.mark.requires_postgres


async def test_legacy_vector_search_is_explicit_until_generation_is_published(
    db_sessions: Sessions,
    db_dimensions: int,
) -> None:
    base, _, _ = await corpus(db_sessions)
    embedder = LocalEmbedder(db_dimensions)
    pair = build_indexes(db_dimensions)
    request = RetrievalRequest(base_id=base, query="原文", limit=5)
    final = NaiveVector(pair, embedder)
    async with db_sessions() as session:
        with pytest.raises(RetrievalUnavailable):
            await final.retrieve(session, request)
        partial = await Hybrid(pair, embedder).retrieve(session, request)
        assert not partial.is_complete
        assert "关键词" in partial.note
    await start_job(db_sessions, base, uuid.uuid4(), local_space(db_dimensions))
    worker = ReembeddingSteps(db_sessions, embedder, unchanged, 8)
    await worker.run_one()
    await worker.run_one()
    async with db_sessions() as session:
        answer = await final.retrieve(session, request)
        assert len(answer.hits) == 3
        assert answer.is_complete
