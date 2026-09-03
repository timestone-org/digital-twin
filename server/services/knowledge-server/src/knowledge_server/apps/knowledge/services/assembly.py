"""按配置与启动探测，装出这一次要用的索引与检索策略。

⚠ 只有这一处做「走哪一档」的判定。api 侧与 worker 侧各判一遍的话，
`/capabilities` 报的与实际写入/检索走的可以漂开——而那时账单与延迟是唯一的
迹象（ADR-0034 决策四）。
"""

from dataclasses import dataclass, field

from knowledge_server.apps.knowledge.services.capability import (
    keyword_choice,
    vector_choice,
)
from knowledge_server.apps.knowledge.services.embedding import Embedder
from knowledge_server.apps.knowledge.services.indexing import (
    IndexPair,
    build_indexes,
)
from knowledge_server.apps.knowledge.services.llm import Answerer
from knowledge_server.apps.knowledge.services.reranking import (
    NullReranker,
    Reranker,
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


@dataclass(frozen=True)
class Lanes:
    """装策略要的那几样。

    ⚠ 打成一包而不是逐个形参：调用面的形参上限是 5，而这里已经四样了。
    到顶那天最省事的改法是把新资源塞进已有的某一格里，而那正是让两路策略
    开始互相知道对方的第一步。
    """

    settings: Settings
    probe: IndexProbe
    embedder: Embedder
    answerer: Answerer
    # 重排那一路。⚠ 缺省是诚实缺席而不是 `None`：不给它的调用点拿到的是
    # 一份不重排的策略，而不是一个会在第一次检索时炸的空洞
    reranker: Reranker = field(default_factory=NullReranker)


def strategies(lanes: Lanes) -> tuple[RetrievalStrategy, ...]:
    """这一次能用的那几种检索策略。

    Args: lanes。
    """
    return build_strategies(
        RetrievalDeps(
            indexes=index_pair(lanes.settings, lanes.probe),
            embedder=lanes.embedder,
            answerer=lanes.answerer,
            reranker=lanes.reranker,
        )
    )
