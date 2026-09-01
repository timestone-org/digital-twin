"""这套部署接了哪一路嵌入。

⚠ 只有一路实现（OpenAI 兼容端点，住在 `domain/llmcore`）。留着这层注册面
是为了让「加第二路」是加一个文件加一行，而不是改调用方的函数体。
"""

from collections.abc import Sequence
from dataclasses import dataclass

from knowledge_server.apps.knowledge.services.embedding.ports import (
    Embedder,
    NullEmbedder,
)
from llmcore import EmbeddingAdapter, build_openai_embedding
from llmcore.endpoints import EmbeddingEndpoint


@dataclass(frozen=True)
class RemoteEmbedder:
    """把 `llmcore` 的适配器包成本层的 `Embedder`。

    ⚠ 包一层而不是直接用：本层多一格 `can_embed`，而调用方靠它决定说哪句话。
    让调用方去判 `adapter is None` 的话，那个判断会散布到每个调用点。
    """

    adapter: EmbeddingAdapter

    @property
    def id(self) -> str:
        """这一路的名字，会跟着每一条向量落库。"""
        return self.adapter.id

    @property
    def dimensions(self) -> int:
        """向量维数。"""
        return self.adapter.dimensions

    @property
    def can_embed(self) -> bool:
        """接上了就能算。"""
        return True

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """把一批文本转成向量。

        Args: texts。
        """
        return await self.adapter.embed(texts)


def build_embedder(endpoint: EmbeddingEndpoint | None) -> Embedder:
    """按端点装一路嵌入；没配就给 `NullEmbedder`。

    ⚠ 给 `Null*` 而不是 `None`：调用方于是不必写「这一路在不在」的分支，
    而缺席由 `can_embed` 如实说出来。

    Args: endpoint。
    """
    made = build_openai_embedding(endpoint)
    return NullEmbedder() if made is None else RemoteEmbedder(adapter=made)
