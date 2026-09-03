"""动态重排适配器：端点由口子随时给，没有就如实缺席。

守两条：解不出端点时抛 `RerankUnavailable` 而不是回空表（回空表会被读成
「一条都不相关」），以及方言认不出时当场抛而不是退回默认那一路。
"""

import httpx
import pytest
from pydantic import SecretStr

from llmcore import (
    DynamicRerankAdapter,
    RerankEndpoint,
    RerankScore,
    RerankUnavailable,
)
from llmcore.rerank import (
    DIALECT_DASHSCOPE,
    DIALECT_JINA,
    Reranker,
    UnknownRerankDialect,
)


def _endpoint(
    model: str = "rerank-1", dialect: str = DIALECT_JINA
) -> RerankEndpoint:
    return RerankEndpoint(
        base_url="https://endpoint/v1",
        api_key=SecretStr("k1"),
        model=model,
        timeout_s=5.0,
        dialect=dialect,
    )


class _Switch:
    """一个可以在用例里换端点的解析口子。"""

    def __init__(self, endpoint: RerankEndpoint | None) -> None:
        self.endpoint = endpoint
        self.refreshed = 0

    def resolve(self) -> RerankEndpoint | None:
        return self.endpoint

    async def refresh(self) -> None:
        self.refreshed += 1


def test_it_satisfies_the_rerank_protocol() -> None:
    made = DynamicRerankAdapter(resolve=_Switch(_endpoint()).resolve)
    assert isinstance(made, Reranker)


def test_readiness_follows_the_resolver() -> None:
    switch = _Switch(None)
    made = DynamicRerankAdapter(resolve=switch.resolve)
    assert made.is_ready is False
    assert made.model is None
    assert made.dialect == ""
    switch.endpoint = _endpoint(dialect=DIALECT_DASHSCOPE)
    assert made.is_ready is True
    assert made.model == "rerank-1"
    assert made.dialect == DIALECT_DASHSCOPE


async def test_no_endpoint_means_a_named_refusal_not_an_empty_list() -> None:
    made = DynamicRerankAdapter(resolve=_Switch(None).resolve)
    with pytest.raises(RerankUnavailable):
        await made.rerank("问", ["甲"], top_n=1)


async def test_the_refresh_hook_runs_before_each_call() -> None:
    switch = _Switch(None)
    made = DynamicRerankAdapter(resolve=switch.resolve, refresh=switch.refresh)
    with pytest.raises(RerankUnavailable):
        await made.rerank("问", ["甲"], top_n=1)
    assert switch.refreshed == 1


class _FakeInner:
    """替掉真调用面的那一层：只记下被问了什么。"""

    def __init__(self) -> None:
        self.asked: list[tuple[str, list[str], int]] = []

    async def rerank(
        self, query: str, documents: list[str], *, top_n: int
    ) -> list[RerankScore]:
        self.asked.append((query, list(documents), top_n))
        return [RerankScore(index=0, score=0.5)]


async def test_a_resolved_endpoint_goes_through_to_the_call_face(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    switch = _Switch(_endpoint())
    made = DynamicRerankAdapter(resolve=switch.resolve, refresh=switch.refresh)
    inner = _FakeInner()
    monkeypatch.setattr(made, "_reranker_for", lambda _endpoint: inner)
    ranked = await made.rerank("问", ["甲", "乙"], top_n=1)
    assert ranked == [RerankScore(index=0, score=0.5)]
    assert inner.asked == [("问", ["甲", "乙"], 1)]
    assert switch.refreshed == 1


def test_an_unknown_dialect_is_refused_instead_of_silently_defaulting() -> None:
    made = DynamicRerankAdapter(
        resolve=_Switch(_endpoint(dialect="cohere-v3")).resolve
    )
    with pytest.raises(UnknownRerankDialect):
        made._reranker_for(  # pyright: ignore[reportPrivateUsage]
            _endpoint(dialect="cohere-v3")
        )


def test_one_http_client_serves_every_endpoint_it_ever_resolves() -> None:
    """⚠ 每次调用现造一个客户端的话，连接不会自己回收，跑久了端口耗尽——
    而现象与重排这件事毫无关系。"""
    switch = _Switch(_endpoint())
    made = DynamicRerankAdapter(resolve=switch.resolve)
    first = made._reranker_for(  # pyright: ignore[reportPrivateUsage]
        _endpoint()
    )
    again = made._reranker_for(  # pyright: ignore[reportPrivateUsage]
        _endpoint(model="rerank-2", dialect=DIALECT_DASHSCOPE)
    )
    assert first.client is again.client
    assert isinstance(first.client, httpx.AsyncClient)
    assert again.dialect.code == DIALECT_DASHSCOPE
    assert again.id == made.id
