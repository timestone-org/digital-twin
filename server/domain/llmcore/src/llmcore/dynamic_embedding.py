"""嵌入那一路的动态版：端点由一个解析口子随时给，换了就换客户端。

⚠ 与 `OpenAiCompatEmbeddingAdapter` 分开而不是改它：那一份是「端点定死、
客户端造一次留着」，两个消费方的既有用例都钉着它；这一份只多做一件事——
每次调用前问一次「此刻该打哪」，端点没变就复用上一次造的那一个。

⚠ 端点解不出时 `embed` 抛 `ModelDisabled`，`is_ready` 为假：消费方据此如实
说「这一路没接」，而不是把一次没算出来的向量当成空向量落库。
"""

from collections.abc import Awaitable, Callable, Sequence

from openai import AsyncOpenAI

from llmcore.endpoints import EmbeddingEndpoint
from llmcore.errors import ModelDisabled
from llmcore.openai_embedding import (
    EMBEDDING_SOURCE,
    OpenAiCompatEmbeddingAdapter,
)

EndpointOf = Callable[[], EmbeddingEndpoint | None]
Refresh = Callable[[], Awaitable[object]]


class DynamicEmbeddingAdapter:
    """按解析口子造嵌入客户端的那一路。"""

    def __init__(
        self,
        *,
        resolve: EndpointOf,
        refresh: Refresh | None = None,
        id: str = EMBEDDING_SOURCE,  # 理由：与协议里的属性同名
    ) -> None:
        """Args: resolve（此刻该打哪；给 `None` 即没接）, refresh（调用前先让
        目录刷新一次；没有就跳过）, id（能力面上的名字）。
        """
        self._resolve = resolve
        self._refresh = refresh
        self._id = id
        self._built: OpenAiCompatEmbeddingAdapter | None = None
        self._built_for: tuple[str, str, str, float] | None = None

    @property
    def id(self) -> str:
        """这一路嵌入来源的名字。"""
        return self._id

    @property
    def is_ready(self) -> bool:
        """此刻解得出端点吗。"""
        return self._resolve() is not None

    @property
    def model(self) -> str | None:
        """此刻用的模型名；没接时是 `None`。"""
        endpoint = self._resolve()
        return None if endpoint is None else endpoint.model

    @property
    def dimensions(self) -> int:
        """向量维数。没接时是 0。"""
        endpoint = self._resolve()
        return 0 if endpoint is None else endpoint.dimensions

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """把一批文本转成向量，顺序与入参一一对应。

        Args: texts。
        """
        if self._refresh is not None:
            await self._refresh()
        endpoint = self._resolve()
        if endpoint is None:
            raise ModelDisabled("这套部署没有接嵌入档")
        return await self._adapter_for(endpoint).embed(texts)

    def _adapter_for(
        self, endpoint: EmbeddingEndpoint
    ) -> OpenAiCompatEmbeddingAdapter:
        """端点没变就复用上一次造的客户端；变了就换一个。

        ⚠ 复用是必须的：每次调用现造一个客户端，连接不会自己回收，
        跑久了之后端口耗尽，而现象与嵌入这件事毫无关系。

        Args: endpoint。
        """
        signature = (
            endpoint.base_url,
            endpoint.api_key.get_secret_value(),
            endpoint.model,
            endpoint.timeout_s,
        )
        if self._built is None or self._built_for != signature:
            self._built = OpenAiCompatEmbeddingAdapter(
                client=AsyncOpenAI(
                    base_url=endpoint.base_url,
                    api_key=endpoint.api_key.get_secret_value(),
                    timeout=endpoint.timeout_s,
                    max_retries=0,
                ),
                model=endpoint.model,
                dimensions=endpoint.dimensions,
                id=self._id,
            )
            self._built_for = signature
        return self._built
