"""层 4 嵌入：文本变成向量。可以整个缺席，而缺席要如实说出来。"""

from knowledge_server.apps.knowledge.services.embedding.ports import (
    Embedder,
    EmbeddingUnavailable,
    NullEmbedder,
)
from knowledge_server.apps.knowledge.services.embedding.registry import (
    RemoteEmbedder,
    build_embedder,
)

__all__ = [
    "Embedder",
    "EmbeddingUnavailable",
    "NullEmbedder",
    "RemoteEmbedder",
    "build_embedder",
]
