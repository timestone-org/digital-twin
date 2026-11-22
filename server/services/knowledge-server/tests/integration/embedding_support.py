"""确定性测试模型与实际调用绑定的空间。"""

from collections.abc import Sequence

from knowledge_server.apps.knowledge.services.embedding import (
    EmbeddingSpace,
    EmbeddingUnavailable,
)
from llmcore.embedding_snapshot import EmbeddingBatch, embedding_identity


class CertifiedTestEmbedder:
    id: str
    model: str | None
    dimensions: int
    can_embed: bool

    @property
    def space(self) -> EmbeddingSpace | None:
        if not self.can_embed or self.model is None:
            return None
        return EmbeddingSpace(
            embedding_identity(
                "http://local-fixture", self.model, self.dimensions, self.id
            ),
            self.model,
            self.dimensions,
        )

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        raise NotImplementedError

    async def embed_batch(self, texts: Sequence[str]) -> EmbeddingBatch:
        space = self.space
        if space is None:
            raise EmbeddingUnavailable("fixture unavailable")
        return EmbeddingBatch(
            space.identity, space.model, await self.embed(texts)
        )
