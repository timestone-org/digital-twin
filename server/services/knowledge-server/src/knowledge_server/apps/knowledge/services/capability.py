"""能力面的装配：把配置与启动时的探测结果摊成出参。

⚠ 报的是「此刻真能用哪一档」，不是「配置想用哪一档」。两者不一致时以探测为准，
并把原因一并说出来——悄悄退化的表现是「有点慢」「有点不准」，而没有人会去查
一件没人说过的事（ADR-0034 决策五）。
"""

from dataclasses import dataclass

from knowledge_server.apps.knowledge.models.knowledge_base import STRATEGIES
from knowledge_server.apps.knowledge.schemas import (
    CapabilityOut,
    IndexCapabilityOut,
    RerankCapabilityOut,
)
from knowledge_server.apps.knowledge.services.parsing import (
    accepted_suffixes,
)
from knowledge_server.apps.knowledge.services.retrieval import (
    RetrievalStrategy,
)
from knowledge_server.apps.knowledge.services.sources import (
    KnowledgeSource,
    source_kinds,
)
from knowledge_server.probe import IndexProbe
from knowledge_server.settings import Settings

# 与 `services/indexing/registry.py` 的注册名逐字对齐
VECTOR_FAST = "pgvector"
VECTOR_FALLBACK = "bruteforce"
KEYWORD_FAST = "trgm"
KEYWORD_FALLBACK = "like"


def vector_choice(settings: Settings, probe: IndexProbe) -> tuple[str, str]:
    """向量那一路实际走哪一档，以及走回退档的原因。

    ⚠ 配置强制 `pgvector` 而库里没有时**仍然回退**，不抛：抛的话服务起不来，
    而这一档只是加速——正确性不依赖它。原因如实报出去就够了。

    Args: settings, probe。
    """
    if settings.vector_index == VECTOR_FALLBACK:
        return (VECTOR_FALLBACK, "配置指定走应用层余弦")
    if not probe.is_probed:
        return (VECTOR_FALLBACK, "启动时探测不到库，按未启用加速索引处理")
    if not probe.has_pgvector:
        return (VECTOR_FALLBACK, "这套部署的 Postgres 没装 pgvector")
    if not probe.has_vector_table:
        return (
            VECTOR_FALLBACK,
            "pgvector 装了但加速表还没建，跑一次 "
            "`python -m knowledge_server.index --enable`",
        )
    return (VECTOR_FAST, "")


def keyword_choice(settings: Settings, probe: IndexProbe) -> tuple[str, str]:
    """关键词那一路实际走哪一档，以及走回退档的原因。

    Args: settings, probe。
    """
    if settings.keyword_index == KEYWORD_FALLBACK:
        return (KEYWORD_FALLBACK, "配置指定走 ILIKE 扫描")
    if not probe.is_probed:
        return (KEYWORD_FALLBACK, "启动时探测不到库，按未启用加速索引处理")
    if not probe.has_trgm:
        return (KEYWORD_FALLBACK, "这套部署的 Postgres 没装 pg_trgm")
    return (KEYWORD_FAST, "")


def index_capability_of(
    settings: Settings, probe: IndexProbe
) -> IndexCapabilityOut:
    """两路索引各自走在哪一档上。

    ⚠ 两路各自报各自的原因，不合并成一句：一路走加速档、另一路走回退档是常态，
    合成一句之后没人知道说的是哪一路。

    Args: settings, probe。
    """
    vector, vector_reason = vector_choice(settings, probe)
    keyword, keyword_reason = keyword_choice(settings, probe)
    reasons = [one for one in (vector_reason, keyword_reason) if one]
    return IndexCapabilityOut(
        vector=vector, keyword=keyword, reason="；".join(reasons)
    )


def ready_strategies(
    strategies: tuple[RetrievalStrategy, ...], *, is_model_enabled: bool
) -> list[str]:
    """此刻**真能用**的检索策略。

    ⚠ 与「装了哪些」分开报：靠模型撑起来的那一路在没配对话档时如实不可用，
    **不悄悄退化成别的**——悄悄退化的表现是「质量忽然变差了」，
    而没有任何一处报错（ADR-0035 决策二）。

    ⚠ 判据问的是**策略自己**（`is_llm_backed`），不是在这里写死一句
    「agentic 要模型」：写死的话，加第二路要模型的策略时这里会漏判，
    而漏判的表现是界面上把一路点不动的策略摆出来。

    Args: strategies, is_model_enabled（对话档此刻接没接）。
    """
    return [
        one.name
        for one in strategies
        if is_model_enabled or not one.is_llm_backed
    ]


# 没接重排时说得出的那句话。⚠ 一定要说：没接时检索走的是融合名次那一档，
# 而悄悄退化的表现正是「质量忽然变了、一处都不报错」
NO_RERANK_REASON = (
    "模型管理页上还没给「知识库重排」分配模型，本部署按融合名次给出结果"
)


@dataclass(frozen=True)
class ModelLanes:
    """几路模型此刻接没接。

    ⚠ 由适配器**此刻**回答，不由配置回答：端点来自运行期可改的目录
    （ADR-0039），配置里的开关只是它的永久默认值。
    """

    is_embedding_enabled: bool
    is_model_enabled: bool
    # 重排接没接，以及此刻用的是哪个模型。⚠ 缺省是「没接」：这一格是后加的，
    # 不给它的调用点本来就没有这一路
    is_rerank_enabled: bool = False
    rerank_model: str = ""


def rerank_capability_of(lanes: ModelLanes) -> RerankCapabilityOut:
    """重排那一路此刻的样子。

    Args: lanes。
    """
    if not lanes.is_rerank_enabled:
        return RerankCapabilityOut(is_enabled=False, reason=NO_RERANK_REASON)
    return RerankCapabilityOut(
        is_enabled=True, model=lanes.rerank_model, reason=""
    )


def capability_of(
    settings: Settings,
    probe: IndexProbe,
    sources: tuple[KnowledgeSource, ...] = (),
    strategies: tuple[RetrievalStrategy, ...] = (),
    lanes: ModelLanes | None = None,
) -> CapabilityOut:
    """这套部署此刻的知识库能力。

    Args: settings, probe, sources（接了哪几路来源）, strategies（装了哪几种
        检索策略）, lanes（两路模型此刻接没接；不给就按配置里的开关答）。
    """
    if lanes is None:
        lanes = ModelLanes(
            is_embedding_enabled=settings.embedding_enabled,
            is_model_enabled=settings.model_enabled,
        )
    return CapabilityOut(
        is_embedding_enabled=lanes.is_embedding_enabled,
        is_model_enabled=lanes.is_model_enabled,
        is_asr_enabled=settings.asr_enabled,
        strategies=list(STRATEGIES),
        ready_strategies=ready_strategies(
            strategies, is_model_enabled=lanes.is_model_enabled
        ),
        source_kinds=list(source_kinds(sources)),
        accepted_suffixes=list(accepted_suffixes()),
        index=index_capability_of(settings, probe),
        rerank=rerank_capability_of(lanes),
    )
