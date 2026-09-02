"""动态嵌入适配器：端点由口子随时给，换了就换客户端，没有就如实缺席。

守两条：端点没变时**复用**同一个客户端（现造一个等于每次新开一组连接，跑久
了端口耗尽），以及解不出端点时抛 `ModelDisabled` 而不是回空向量。
"""

from typing import Any

import pytest
from pydantic import SecretStr

from llmcore import (
    DynamicEmbeddingAdapter,
    EmbeddingAdapter,
    EmbeddingEndpoint,
    ModelDisabled,
)
from llmcore.dynamic_embedding import OpenAiCompatEmbeddingAdapter


def _endpoint(model: str = "embed-1", key: str = "k1") -> EmbeddingEndpoint:
    return EmbeddingEndpoint(
        base_url="https://endpoint/v1",
        api_key=SecretStr(key),
        model=model,
        timeout_s=5.0,
        dimensions=3,
    )


class _Switch:
    """一个可以在用例里换端点的解析口子。"""

    def __init__(self, endpoint: EmbeddingEndpoint | None) -> None:
        self.endpoint = endpoint
        self.refreshed = 0

    def resolve(self) -> EmbeddingEndpoint | None:
        return self.endpoint

    async def refresh(self) -> None:
        self.refreshed += 1


class _FakeInner:
    """替掉真客户端的那一层：只记下被问了什么。"""

    def __init__(self, model: str) -> None:
        self.model = model
        self.asked: list[list[str]] = []

    async def embed(self, texts: list[str]) -> list[list[float]]:
        self.asked.append(list(texts))
        return [[1.0, 0.0, 0.0] for _ in texts]


def test_it_satisfies_the_embedding_protocol() -> None:
    made = DynamicEmbeddingAdapter(resolve=_Switch(_endpoint()).resolve)
    assert isinstance(made, EmbeddingAdapter)


def test_readiness_follows_the_resolver() -> None:
    switch = _Switch(None)
    made = DynamicEmbeddingAdapter(resolve=switch.resolve)
    assert made.is_ready is False
    assert made.dimensions == 0
    assert made.model is None
    switch.endpoint = _endpoint()
    assert made.is_ready is True
    assert made.dimensions == 3
    assert made.model == "embed-1"


async def test_no_endpoint_means_a_named_refusal_not_an_empty_vector() -> None:
    made = DynamicEmbeddingAdapter(resolve=_Switch(None).resolve)
    with pytest.raises(ModelDisabled):
        await made.embed(["甲"])


async def test_the_refresh_hook_runs_before_each_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    switch = _Switch(_endpoint())
    made = DynamicEmbeddingAdapter(
        resolve=switch.resolve, refresh=switch.refresh
    )
    inner = _FakeInner("embed-1")
    monkeypatch.setattr(made, "_adapter_for", lambda _endpoint: inner)
    await made.embed(["甲"])
    await made.embed(["乙"])
    assert switch.refreshed == 2
    assert inner.asked == [["甲"], ["乙"]]


def test_the_client_is_reused_until_the_endpoint_changes() -> None:
    switch = _Switch(_endpoint())
    made = DynamicEmbeddingAdapter(resolve=switch.resolve)
    first = made._adapter_for(
        _endpoint()
    )  # pyright: ignore[reportPrivateUsage]
    again = made._adapter_for(
        _endpoint()
    )  # pyright: ignore[reportPrivateUsage]
    assert first is again
    assert isinstance(first, OpenAiCompatEmbeddingAdapter)
    changed = made._adapter_for(  # pyright: ignore[reportPrivateUsage]
        _endpoint(key="k2")
    )
    assert changed is not first
    assert changed.model == "embed-1"


def test_the_built_client_carries_the_endpoint_shape() -> None:
    made = DynamicEmbeddingAdapter(resolve=_Switch(_endpoint()).resolve)
    built = made._adapter_for(
        _endpoint()
    )  # pyright: ignore[reportPrivateUsage]
    client: Any = built.client
    assert str(client.base_url).startswith("https://endpoint/v1")
    assert built.dimensions == 3
    assert built.id == made.id
