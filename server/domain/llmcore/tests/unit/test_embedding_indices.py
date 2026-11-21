"""以实际 SDK 解析的索引对齐每一条输入文本。"""

import httpx
import pytest
from openai import AsyncOpenAI

from llmcore.openai_embedding import OpenAiCompatEmbeddingAdapter


async def _embed(indices: list[int]) -> list[list[float]]:
    def respond(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "model": "demo",
                "data": [
                    {"index": index, "embedding": vector}
                    for index, vector in zip(
                        indices, [[0.0, 1.0], [1.0, 0.0]], strict=True
                    )
                ],
            },
        )

    async with AsyncOpenAI(
        api_key="synthetic",
        base_url="https://embeddings.test/v1",
        max_retries=0,
        http_client=httpx.AsyncClient(
            timeout=1, transport=httpx.MockTransport(respond)
        ),
    ) as client:
        adapter = OpenAiCompatEmbeddingAdapter(
            client=client, model="demo", dimensions=2
        )
        return (await adapter.embed_batch(["甲", "乙"])).vectors


async def test_reordered_results_follow_the_input_index() -> None:
    assert await _embed([1, 0]) == [[1.0, 0.0], [0.0, 1.0]]


@pytest.mark.parametrize(
    "indices", [[0, 0], [0, 2], [-1, 1]], ids=["duplicate", "high", "negative"]
)
async def test_invalid_indices_reject_the_entire_batch(
    indices: list[int],
) -> None:
    with pytest.raises(ValueError, match="索引"):
        await _embed(indices)
