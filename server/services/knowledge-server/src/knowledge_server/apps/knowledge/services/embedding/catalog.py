"""按当前用途或库已发布的身份解析仍然启用的嵌入端点。"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from openai import AsyncOpenAI, DefaultAsyncHttpxClient, OpenAIError

from knowledge_server.apps.knowledge.services.embedding.ports import (
    EmbeddingSpace,
    EmbeddingUnavailable,
)
from knowledge_server.llm_purposes import PURPOSE_EMBEDDING
from llmcore import OpenAiCompatEmbeddingAdapter
from llmcore.catalog import MODEL_KIND_EMBEDDING, ModelSpec, ProviderSpec
from llmcore.catalog_client import CatalogSource
from llmcore.embedding_snapshot import EmbeddingBatch, embedding_identity
from llmcore.endpoints import EmbeddingEndpoint
from llmcore.errors import classified


@dataclass(frozen=True)
class Binding:
    endpoint: EmbeddingEndpoint
    source: str

    @property
    def space(self) -> EmbeddingSpace:
        end = self.endpoint
        return EmbeddingSpace(
            embedding_identity(
                end.base_url, end.model, end.dimensions, self.source
            ),
            end.model,
            end.dimensions,
        )


@dataclass(frozen=True)
class CatalogTransport:
    catalog: CatalogSource
    configured: Callable[[], EmbeddingEndpoint | None]
    timeout_s: float
    http: DefaultAsyncHttpxClient = field(
        default_factory=DefaultAsyncHttpxClient, repr=False
    )

    def _registered(
        self, provider: ProviderSpec, model: ModelSpec
    ) -> Binding | None:
        if (
            not provider.is_enabled
            or not provider.is_endpoint_based
            or model.kind != MODEL_KIND_EMBEDDING
            or model.dimensions is None
        ):
            return None
        ep = EmbeddingEndpoint(
            provider.base_url,
            provider.api_key,
            model.name,
            self.timeout_s,
            model.dimensions,
        )
        return Binding(ep, "catalog:" + provider.id)

    def find(self, identity: str | None) -> Binding | None:
        """只选用途分配或与库登记身份完全相同的有效配置。Args: identity。"""
        catalog = self.catalog.snapshot()
        if identity is None:
            chosen = catalog.resolve(PURPOSE_EMBEDDING)
            if chosen is not None:
                bound = self._registered(chosen.provider, chosen.model)
                if bound is not None:
                    return bound
        else:
            for provider in catalog.providers:
                for model in provider.models_of(MODEL_KIND_EMBEDDING):
                    bound = self._registered(provider, model)
                    if bound is not None and bound.space.identity == identity:
                        return bound
        endpoint = self.configured()
        if endpoint is None:
            return None
        fallback = Binding(endpoint, "configured")
        return (
            fallback
            if identity is None or fallback.space.identity == identity
            else None
        )

    async def embed(
        self, binding: Binding, texts: Sequence[str]
    ) -> EmbeddingBatch:
        """使用同一份配置执行请求并确认返回位置。Args: binding, texts。"""
        end = binding.endpoint
        client = AsyncOpenAI(
            base_url=end.base_url,
            api_key=end.api_key.get_secret_value(),
            timeout=end.timeout_s,
            max_retries=0,
            http_client=self.http,
        )
        adapter = OpenAiCompatEmbeddingAdapter(
            client, end.model, end.dimensions, id=binding.source
        )
        try:
            return await adapter.embed_batch(texts)
        except OpenAIError as error:
            raise classified(error) from error


@dataclass(frozen=True)
class CatalogEmbedder:
    transport: CatalogTransport
    max_input_tokens: int
    bound_identity: str | None = None
    id: str = "openai-compat"

    @property
    def space(self) -> EmbeddingSpace | None:
        selected = self.transport.find(self.bound_identity)
        return selected.space if selected else None

    @property
    def can_embed(self) -> bool:
        return self.space is not None

    @property
    def dimensions(self) -> int:
        selected = self.space
        return selected.dimensions if selected else 0

    @property
    def model(self) -> str | None:
        selected = self.space
        return selected.model if selected else None

    def for_space(self, identity: str) -> "CatalogEmbedder | None":
        """仅打开与此身份匹配且仍启用的模型。Args: identity。"""
        if self.transport.find(identity) is None:
            return None
        return CatalogEmbedder(self.transport, self.max_input_tokens, identity)

    async def embed_batch(self, texts: Sequence[str]) -> EmbeddingBatch:
        await self.transport.catalog.refresh()
        binding = self.transport.find(self.bound_identity)
        if binding is None:
            raise EmbeddingUnavailable("已发布模型当前不可用")
        return await self.transport.embed(binding, texts)

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return (await self.embed_batch(texts)).vectors


async def close_embedding(embedder: object) -> None:
    """关闭本进程共享的嵌入 HTTP 连接池。Args: embedder。"""
    if isinstance(embedder, CatalogEmbedder):
        await embedder.transport.http.aclose()
