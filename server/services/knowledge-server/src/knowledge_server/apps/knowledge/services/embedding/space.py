"""知识库对已发布索引的嵌入空间核验。"""

import hashlib
from typing import Protocol, runtime_checkable

from knowledge_server.apps.knowledge.models import KnowledgeBase
from knowledge_server.apps.knowledge.models.knowledge_base import (
    EMBEDDING_MODEL_MAX_LENGTH,
)
from knowledge_server.apps.knowledge.schemas.reembedding import VectorStatus
from knowledge_server.apps.knowledge.services.embedding.ports import (
    Embedder,
    EmbeddingSpace,
    SnapshotEmbedder,
)

UNVERIFIED = "旧向量未记录可核验的嵌入来源，请管理员预览并启动整库重嵌"
MISMATCH = (
    "当前可用模型与知识库固定的嵌入空间不同，请恢复原模型或由管理员整库重嵌"
)
NO_SPACE = "这个库还没有可核验的向量索引"
NO_MODEL = "这套部署没接嵌入档"
NOTES = {
    "unindexed": NO_SPACE,
    "legacy_unverified": UNVERIFIED,
    "model_unavailable": NO_MODEL,
    "space_mismatch": MISMATCH,
    "ready": "",
}


def current(embedder: Embedder) -> EmbeddingSpace | None:
    """当前目录指定的目标空间。Args: embedder。"""
    return embedder.space if isinstance(embedder, SnapshotEmbedder) else None


@runtime_checkable
class PinnedResolver(Protocol):
    def for_space(self, identity: str) -> SnapshotEmbedder | None: ...


def for_base(
    base: KnowledgeBase, embedder: Embedder
) -> SnapshotEmbedder | None:
    """取得能为这个库已发布空间作答的模型。Args: base, embedder。"""
    required = base.embedding_space_id
    if required is None:
        return None
    if (
        isinstance(embedder, SnapshotEmbedder)
        and embedder.space is not None
        and embedder.space.identity == required
    ):
        return embedder
    if isinstance(embedder, PinnedResolver):
        return embedder.for_space(required)
    return None


def status(base: KnowledgeBase, embedder: Embedder) -> VectorStatus:
    """当前实际可用的向量读取状态。Args: base, embedder。"""
    if base.embedding_space_id is None:
        return (
            "legacy_unverified"
            if base.embedding_model is not None
            else "unindexed"
        )
    if for_base(base, embedder) is not None:
        return "ready"
    return (
        "space_mismatch"
        if current(embedder) is not None
        else "model_unavailable"
    )


def tag(identity: str) -> str:
    """原索引表中可与旧适配器名区分的请求证明。Args: identity。"""
    return "space:" + identity


def model_label(model: str) -> str:
    """为既有模型名列保留有界表示。Args: model。"""
    if len(model) <= EMBEDDING_MODEL_MAX_LENGTH:
        return model
    return "sha256:" + hashlib.sha256(model.encode()).hexdigest()
