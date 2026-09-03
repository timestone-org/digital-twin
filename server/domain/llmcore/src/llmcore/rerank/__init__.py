"""重排：一批候选按与问题的相关度重新排一次序。方言可插拔（ADR-0042）。"""

from llmcore.rerank.client import RERANK_SOURCE, HttpReranker
from llmcore.rerank.dashscope import DIALECT_DASHSCOPE
from llmcore.rerank.dynamic import DynamicRerankAdapter
from llmcore.rerank.jina import DIALECT_JINA
from llmcore.rerank.ports import (
    RerankDialect,
    Reranker,
    RerankQuery,
    RerankScore,
    RerankShapeUnreadable,
    RerankUnavailable,
)
from llmcore.rerank.registry import (
    DEFAULT_RERANK_DIALECT,
    DIALECTS,
    RERANK_DIALECTS,
    UnknownRerankDialect,
    dialect_of,
)

__all__ = [
    "DEFAULT_RERANK_DIALECT",
    "DIALECTS",
    "DIALECT_DASHSCOPE",
    "DIALECT_JINA",
    "RERANK_DIALECTS",
    "RERANK_SOURCE",
    "DynamicRerankAdapter",
    "HttpReranker",
    "RerankDialect",
    "RerankQuery",
    "RerankScore",
    "RerankShapeUnreadable",
    "RerankUnavailable",
    "Reranker",
    "UnknownRerankDialect",
    "dialect_of",
]
