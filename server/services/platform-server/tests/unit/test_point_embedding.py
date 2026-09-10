"""嵌入的数值校验、分段保全与上游形状失败。"""

import json
from collections.abc import Callable

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic import SecretStr

from llmcore.endpoints import EmbeddingEndpoint
from llmcore.openai_embedding import OpenAiCompatEmbeddingAdapter
from platform_server.apps.collect.services import point_embedding as service

PROFILE = service.PointEmbeddingProfile(
    EmbeddingEndpoint(
        base_url="https://embed.test/v1",
        api_key=SecretStr("test-only"),
        model="test-model",
        timeout_s=1,
        dimensions=2,
    ),
    "test-model-v1",
)


def adapter_for(
    handler: Callable[[httpx.Request], httpx.Response],
) -> OpenAiCompatEmbeddingAdapter:
    client = AsyncOpenAI(
        api_key="test-only",
        base_url="https://embed.test/v1",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    return OpenAiCompatEmbeddingAdapter(
        client=client, model="test-model", dimensions=2
    )


@pytest.mark.parametrize(
    "vector", [[], [0.0, 0.0], [float("nan"), 1.0], [float("inf"), 1.0]]
)
def test_invalid_vectors_are_rejected(vector: list[float]) -> None:
    with pytest.raises(ValueError, match="嵌入向量"):
        service.normalized(vector)


def test_vector_normalization_preserves_direction() -> None:
    assert service.normalized([3.0, 4.0]) == [0.6, 0.8]


async def test_long_descriptions_are_split_and_pooled_without_losing_the_tail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[str] = []

    def response(request: httpx.Request) -> httpx.Response:
        inputs = json.loads(request.content)["input"]
        seen.extend(inputs)
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "index": index,
                        "embedding": [1.0, 0.0] if index == 0 else [0.0, 1.0],
                    }
                    for index, _ in enumerate(inputs)
                ],
                "model": "test-model",
                "usage": {"prompt_tokens": 1, "total_tokens": 1},
            },
        )

    adapter = adapter_for(response)
    monkeypatch.setattr(service, "build_openai_embedding", lambda _: adapter)
    result = await service.embed_texts(PROFILE, ["温" * 256 + "压力"])
    assert seen == ["温" * 256, "压力"]
    assert result[0] == pytest.approx([0.70710678, 0.70710678])
    assert adapter.client.is_closed()


async def test_wrong_result_count_is_rejected_and_client_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = adapter_for(
        lambda _: httpx.Response(
            200,
            json={
                "data": [{"index": 0, "embedding": [1.0, 0.0]}],
                "model": "test-model",
            },
        )
    )
    monkeypatch.setattr(service, "build_openai_embedding", lambda _: adapter)
    with pytest.raises(ValueError, match="数量"):
        await service.embed_texts(PROFILE, ["温度", "压力"])
    assert adapter.client.is_closed()
