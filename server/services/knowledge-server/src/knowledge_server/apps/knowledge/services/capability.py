"""能力面的装配：把配置与启动时的探测结果摊成出参。

⚠ 报的是「此刻真能用哪一档」，不是「配置想用哪一档」。两者不一致时以探测为准，
并把原因一并说出来——悄悄退化的表现是「有点慢」「有点不准」，而没有人会去查
一件没人说过的事（ADR-0034 决策五）。
"""

from knowledge_server.apps.knowledge.schemas import (
    CapabilityOut,
    IndexCapabilityOut,
)
from knowledge_server.container import IndexProbe
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
            "`python -m knowledge_server.index --enable-pgvector`",
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


def capability_of(settings: Settings, probe: IndexProbe) -> CapabilityOut:
    """这套部署此刻的知识库能力。

    Args: settings, probe。
    """
    return CapabilityOut(
        is_embedding_enabled=settings.embedding_enabled,
        is_model_enabled=settings.model_enabled,
        index=index_capability_of(settings, probe),
    )
