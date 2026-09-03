"""按配置装出这一次要用的索引与检索策略。

⚠ 只有这一处装索引。api 侧与 worker 侧各装一份的话，两边的维数与表名可以
漂开，而那时写进去查不出来、两边都不报错。
"""

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

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
from knowledge_server.schema import SchemaFacts
from knowledge_server.settings import Settings


def index_pair(settings: Settings, facts: SchemaFacts) -> IndexPair:
    """这一次要用的两路索引。

    ⚠ 维数以**库上那一列**为准，读不到才退回配置：配置说的是下一次建表会用
    哪个数，而写入要比的是这张表现在是多少维。

    Args: settings, facts。
    """
    return build_indexes(facts.dimensions_or(settings.embedding_dimensions))


@dataclass(frozen=True)
class Lanes:
    """装策略要的那几样。

    ⚠ 打成一包而不是逐个形参：调用面的形参上限是 5，而这里已经四样了。
    到顶那天最省事的改法是把新资源塞进已有的某一格里，而那正是让两路策略
    开始互相知道对方的第一步。
    """

    settings: Settings
    # 库上那几件事实（向量列的维数）。⚠ 缺省是空的一份：不给的话按配置值算，
    # 而那正是读不到库时的行为
    facts: SchemaFacts
    embedder: Embedder
    answerer: Answerer
    # 重排那一路。⚠ 缺省是诚实缺席而不是 `None`：不给它的调用点拿到的是
    # 一份不重排的策略，而不是一个会在第一次检索时炸的空洞
    reranker: Reranker = field(default_factory=NullReranker)


@runtime_checkable
class LanesSource(Protocol):
    """装得出一包 `Lanes` 的那几格，容器就是它。

    ⚠ 收成协议而不是直接认容器：容器 import 的是本层，反过来认它就成环。
    """

    @property
    def settings(self) -> Settings: ...

    @property
    def schema(self) -> SchemaFacts: ...

    @property
    def embedder(self) -> Embedder: ...

    @property
    def answerer(self) -> Answerer: ...

    @property
    def reranker(self) -> Reranker: ...


def lanes_of(source: LanesSource) -> Lanes:
    """把此刻的那几路拧成一包。

    ⚠ **装 `Lanes` 只此一处**：几个调用点各写各的话，漏掉哪一格都不报错——
    漏掉重排那一格的表现是能力面说「已接」而那条链路照旧按融合名次出结果，
    差异只在结果顺序上，没有任何一处会讲出来。契约用例守着这一条。

    Args: source。
    """
    return Lanes(
        settings=source.settings,
        facts=source.schema,
        embedder=source.embedder,
        answerer=source.answerer,
        reranker=source.reranker,
    )


def strategies(lanes: Lanes) -> tuple[RetrievalStrategy, ...]:
    """这一次能用的那几种检索策略。

    Args: lanes。
    """
    return build_strategies(
        RetrievalDeps(
            indexes=index_pair(lanes.settings, lanes.facts),
            embedder=lanes.embedder,
            answerer=lanes.answerer,
            reranker=lanes.reranker,
        )
    )
