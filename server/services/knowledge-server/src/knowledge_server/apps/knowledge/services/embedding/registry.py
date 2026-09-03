"""这套部署接了哪一路嵌入。

⚠ 只有一路实现（OpenAI 兼容端点，住在 `domain/llmcore`）。留着这层注册面
是为了让「加第二路」是加一个文件加一行，而不是改调用方的函数体。

⚠ 端点来自运行期可改的目录时（ADR-0039），`can_embed` 问的是**此刻**解不解
得出端点——装配了不等于能算。
"""

from collections.abc import Sequence
from dataclasses import dataclass

from knowledge_server.apps.knowledge.services.embedding.ports import (
    Embedder,
    NullEmbedder,
)
from llmcore import (
    DynamicEmbeddingAdapter,
    EmbeddingAdapter,
    build_openai_embedding,
)
from llmcore.endpoints import EmbeddingEndpoint


@dataclass(frozen=True)
class RemoteEmbedder:
    """把 `llmcore` 的适配器包成本层的 `Embedder`。

    ⚠ 包一层而不是直接用：本层多一格 `can_embed`，而调用方靠它决定说哪句话。
    让调用方去判 `adapter is None` 的话，那个判断会散布到每个调用点。
    """

    adapter: EmbeddingAdapter
    # 端点的窗口。⚠ 从配置来而不是从适配器来：OpenAI 兼容口径里没有哪一格会
    # 告诉你它是多少，而问不出来的后果是切块层拿一个赌来的数当上限
    max_input_tokens: int

    @property
    def id(self) -> str:
        """这一路的名字，会跟着每一条向量落库。"""
        return self.adapter.id

    @property
    def model(self) -> str | None:
        """此刻用的模型名；没接时是 `None`。"""
        return self.adapter.model if self.can_embed else None

    @property
    def dimensions(self) -> int:
        """向量维数。"""
        return self.adapter.dimensions

    @property
    def can_embed(self) -> bool:
        """此刻解得出端点就能算。"""
        return self.adapter.is_ready

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """把一批文本转成向量。

        Args: texts。
        """
        return await self.adapter.embed(texts)


def build_embedder(
    endpoint: EmbeddingEndpoint | None, max_input_tokens: int
) -> Embedder:
    """按定死的端点装一路嵌入；没配就给 `NullEmbedder`。

    ⚠ 给 `Null*` 而不是 `None`：调用方于是不必写「这一路在不在」的分支，
    而缺席由 `can_embed` 如实说出来。

    Args: endpoint, max_input_tokens。
    """
    made = build_openai_embedding(endpoint)
    if made is None:
        return NullEmbedder()
    return RemoteEmbedder(adapter=made, max_input_tokens=max_input_tokens)


def build_dynamic_embedder(
    adapter: DynamicEmbeddingAdapter, max_input_tokens: int
) -> Embedder:
    """按「调用时才解端点」的适配器装一路嵌入。

    ⚠ 总是装得出来：接没接由 `can_embed` 在每次问到时如实回答，而不是在
    装配期钉死——目录里的分配是运行期可改的。

    Args: adapter, max_input_tokens。
    """
    return RemoteEmbedder(adapter=adapter, max_input_tokens=max_input_tokens)
