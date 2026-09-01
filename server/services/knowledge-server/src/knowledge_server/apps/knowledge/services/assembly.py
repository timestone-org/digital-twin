"""按配置与启动探测，装出这一次要用的索引与检索策略。

⚠ 只有这一处做「走哪一档」的判定。api 侧与 worker 侧各判一遍的话，
`/capabilities` 报的与实际写入/检索走的可以漂开——而那时账单与延迟是唯一的
迹象（ADR-0034 决策四）。
"""

from knowledge_server.apps.knowledge.services.capability import (
    keyword_choice,
    vector_choice,
)
from knowledge_server.apps.knowledge.services.embedding import Embedder
from knowledge_server.apps.knowledge.services.indexing import (
    IndexPair,
    build_indexes,
)
from knowledge_server.apps.knowledge.services.retrieval import (
    RetrievalDeps,
    RetrievalStrategy,
    build_strategies,
)
from knowledge_server.probe import IndexProbe
from knowledge_server.settings import Settings


def index_pair(settings: Settings, probe: IndexProbe) -> IndexPair:
    """这一次要用的两路索引。

    Args: settings, probe。
    """
    vector, _vector_reason = vector_choice(settings, probe)
    keyword, _keyword_reason = keyword_choice(settings, probe)
    return build_indexes(vector, keyword)


def strategies(
    settings: Settings, probe: IndexProbe, embedder: Embedder
) -> tuple[RetrievalStrategy, ...]:
    """这一次能用的那几种检索策略。

    Args: settings, probe, embedder。
    """
    return build_strategies(
        RetrievalDeps(indexes=index_pair(settings, probe), embedder=embedder)
    )
