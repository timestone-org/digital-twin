"""嵌入那一路来源：OpenAI 兼容的 embeddings 端点。

⚠ 与对话那几路分开而不是当成 `ModelKind` 的又一档：它返回的是向量不是
`BaseChatModel`，单价与上下文形状也都不同。混成一档等于每次嵌入都按对话档计费。

⚠ 客户端**造一次留着**，不每次调用现造：现造会让每一次嵌入都新开一组连接，
而连接不会自己回收——表现是跑久了之后端口耗尽，与嵌入这件事毫无关系。
"""

from collections.abc import Sequence
from dataclasses import dataclass

from openai import AsyncOpenAI

from llmcore.endpoints import EmbeddingEndpoint

# 这一路在能力面上的名字。⚠ 是线上契约的一部分：落库的 `embedding_model`
# 旁边存的就是它，换名字会让存量条目看着像另一路算的
EMBEDDING_SOURCE = "openai-compat"


class EmbeddingShapeChanged(RuntimeError):
    """端点回来的维数与配置对不上。

    ⚠ 抛而不是照单全收：维数变了的话，旧条目与新条目算不出有意义的余弦，
    而表现只是「召回忽然变差了」——没有任何一处会报错。
    """


@dataclass(frozen=True)
class OpenAiCompatEmbeddingAdapter:
    """按配置把文本转成向量的那一路。"""

    client: AsyncOpenAI
    model: str
    dimensions: int
    id: str = EMBEDDING_SOURCE
    # 端点定死的这一路造出来就能用；动态那一路才会在运行期变成假
    is_ready: bool = True

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """把一批文本转成向量，顺序与入参一一对应。

        Args: texts。
        """
        answer = await self.client.embeddings.create(
            model=self.model, input=list(texts)
        )
        made = [list(one.embedding) for one in answer.data]
        wrong = next(
            (len(one) for one in made if len(one) != self.dimensions), None
        )
        if wrong is not None:
            raise EmbeddingShapeChanged(
                f"{self.model} 回了 {wrong} 维，配置写的是 {self.dimensions} 维"
            )
        return made


def build_openai_embedding(
    endpoint: EmbeddingEndpoint | None,
) -> OpenAiCompatEmbeddingAdapter | None:
    """按端点装嵌入那一路；没解出端点就给 `None`。

    ⚠ 接不上时给 `None` 而不是抛：消费方可以「只存不排」，而整个服务在没接
    嵌入时仍然要能起。

    Args: endpoint。
    """
    if endpoint is None:
        return None
    return OpenAiCompatEmbeddingAdapter(
        client=AsyncOpenAI(
            base_url=endpoint.base_url,
            api_key=endpoint.api_key.get_secret_value(),
            timeout=endpoint.timeout_s,
            # ⚠ 这一层不重试：一条链路只有一层负责重试，而那一层是调用方的
            # 编排层
            max_retries=0,
        ),
        model=endpoint.model,
        dimensions=endpoint.dimensions,
    )
