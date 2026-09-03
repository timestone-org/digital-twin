"""这套部署装了哪几种检索策略，以及按名字挑一种。

⚠ 注册是**显式元组**，不靠 import 副作用（ADR-0029 决策四）。

⚠ 认不出的名字**当场抛**，不退回默认：退回默认的表现是「库上配的策略一直
没生效」，而配置面看着一切正常。

⚠ 要 LLM 而没接时那一路**如实不可用**（`UnavailableStrategy`），
不悄悄换一路：悄悄换的表现是「质量忽然变差了」，一处都不报错。
"""

from dataclasses import dataclass, field, replace

from knowledge_server.apps.knowledge.errors import UnknownRetrievalStrategy
from knowledge_server.apps.knowledge.services.embedding import Embedder
from knowledge_server.apps.knowledge.services.indexing import IndexPair
from knowledge_server.apps.knowledge.services.llm import Answerer, NullAnswerer
from knowledge_server.apps.knowledge.services.reranking import (
    NullReranker,
    Reranker,
)
from knowledge_server.apps.knowledge.services.retrieval.agentic import (
    AGENTIC,
    Agentic,
)
from knowledge_server.apps.knowledge.services.retrieval.hybrid import (
    HYBRID,
    Hybrid,
)
from knowledge_server.apps.knowledge.services.retrieval.naive import (
    NAIVE,
    NaiveVector,
)
from knowledge_server.apps.knowledge.services.retrieval.ports import (
    RetrievalStrategy,
)


@dataclass(frozen=True)
class RetrievalDeps:
    """造一份策略要的那几样。

    ⚠ 打成一包而不是逐个形参：每加一路策略就可能多一格，而调用面的形参上限
    是 5。到顶那天最省事的改法是把新资源塞进已有的某一格里，而那正是让两路
    策略开始互相知道对方的第一步。
    """

    indexes: IndexPair
    embedder: Embedder
    # 对话档。⚠ 没接时给 `NullAnswerer` 而不是 `None`：`agentic` 于是仍然
    # 装得出来，只是它自己会如实说「用不了」——按 None 来判的话，
    # 「这套部署装了哪几种策略」会随配置变，而那份清单是要上界面的
    answerer: Answerer = field(default_factory=NullAnswerer)
    # 重排那一路。⚠ 同理没接时给 `NullReranker`：接没接由它自己如实回答，
    # 而不是让「装了哪几种策略」跟着变
    reranker: Reranker = field(default_factory=NullReranker)


def build_strategies(
    deps: RetrievalDeps,
) -> tuple[RetrievalStrategy, ...]:
    """按注册序装出这套部署能用的那几种。

    ⚠ 顺序即界面上的先后。加一种 = 加一个文件 + 这里一行 + 一条契约测试。

    ⚠ `naive` **不接重排**：它是基线，也是「召回忽然变差了」时的对照组，
    在它身上再叠一层就没有对照可言了。

    ⚠ `agentic` 手上那份 hybrid 也不接重排：重排由它在合池之后对着原问题做
    一次，让每条改写式各排一次的钱是白花的，而几路的分数还不是同一个基准。

    Args: deps。
    """
    plain = Hybrid(indexes=deps.indexes, embedder=deps.embedder)
    return (
        NaiveVector(indexes=deps.indexes, embedder=deps.embedder),
        replace(plain, reranker=deps.reranker),
        Agentic(hybrid=plain, answerer=deps.answerer, reranker=deps.reranker),
    )


def strategy_names(
    strategies: tuple[RetrievalStrategy, ...],
) -> tuple[str, ...]:
    """装了哪几种，按注册序。

    Args: strategies。
    """
    return tuple(one.name for one in strategies)


def strategy_for(
    name: str, strategies: tuple[RetrievalStrategy, ...]
) -> RetrievalStrategy:
    """按名字挑一种；认不出就抛。

    Args: name（空串即默认那一种）, strategies。
    """
    wanted = name or HYBRID
    for one in strategies:
        if one.name == wanted:
            return one
    raise UnknownRetrievalStrategy(
        f"这套部署没装叫 {wanted} 的检索策略。装了的有："
        f"{'、'.join(strategy_names(strategies))}"
    )


__all__ = [
    "AGENTIC",
    "HYBRID",
    "NAIVE",
    "RetrievalDeps",
    "build_strategies",
    "strategy_for",
    "strategy_names",
]
