"""打一次重排端点：地址怎么拼、密钥怎么带、失败落在哪一档。

守的是失败分档：401 / 400 是「我们发错了」（`ModelRejected`，不该让断路器
打开），超时与 5xx 是「下游此刻不行」（`ModelUnavailable`，该计一次失败）。
"""

import json
from collections.abc import Callable

import httpx
import pytest
from pydantic import SecretStr

from llmcore import (
    ModelRejected,
    ModelUnavailable,
    RerankEndpoint,
)
from llmcore.rerank import DIALECT_JINA, HttpReranker, Reranker, dialect_of


def _endpoint(base_url: str = "https://endpoint/v1") -> RerankEndpoint:
    return RerankEndpoint(
        base_url=base_url,
        api_key=SecretStr("k1"),
        model="rerank-1",
        timeout_s=5.0,
        dialect=DIALECT_JINA,
    )


Handler = Callable[[httpx.Request], httpx.Response]


def _made(
    handler: Handler, *, base_url: str = "https://endpoint/v1"
) -> HttpReranker:
    return HttpReranker(
        client=httpx.AsyncClient(
            transport=httpx.MockTransport(handler), timeout=5.0
        ),
        endpoint=_endpoint(base_url),
        dialect=dialect_of(DIALECT_JINA),
    )


def _ok(request: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "results": [
                {"index": 0, "relevance_score": 0.1},
                {"index": 1, "relevance_score": 0.9},
            ]
        },
        request=request,
    )


def test_it_satisfies_the_rerank_protocol() -> None:
    assert isinstance(_made(_ok), Reranker)


async def test_it_posts_to_the_dialect_path_with_the_key_in_the_header() -> (
    None
):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return _ok(request)

    made = _made(handler, base_url="https://endpoint/api/v1/")
    ranked = await made.rerank("问", ["甲", "乙"], top_n=2)
    assert [one.index for one in ranked] == [1, 0]
    assert str(seen[0].url) == "https://endpoint/api/v1/rerank"
    assert seen[0].headers["Authorization"] == "Bearer k1"


async def test_top_n_never_exceeds_the_batch() -> None:
    """⚠ 有的端点对「要的比给的多」直接回 400，而那条 400 看着像密钥配错。"""
    seen: list[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.content)
        return _ok(request)

    await _made(handler).rerank("问", ["甲", "乙"], top_n=50)
    sent: dict[str, object] = json.loads(seen[0])
    assert sent["top_n"] == 2
    assert sent["documents"] == ["甲", "乙"]


async def test_an_empty_batch_never_touches_the_endpoint() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        del request
        raise AssertionError("空批不该打端点")

    assert await _made(handler).rerank("问", [], top_n=3) == []


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
async def test_our_own_mistakes_never_reach_the_breaker(status: int) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={}, request=request)

    with pytest.raises(ModelRejected):
        await _made(handler).rerank("问", ["甲"], top_n=1)


@pytest.mark.parametrize("status", [429, 500, 503])
async def test_downstream_trouble_is_the_retryable_bucket(status: int) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={}, request=request)

    with pytest.raises(ModelUnavailable) as caught:
        await _made(handler).rerank("问", ["甲"], top_n=1)
    assert caught.value.is_retryable is True


async def test_a_timeout_is_downstream_trouble_not_our_mistake() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("慢", request=request)

    with pytest.raises(ModelUnavailable):
        await _made(handler).rerank("问", ["甲"], top_n=1)


async def test_a_broken_connection_is_downstream_trouble() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("连不上", request=request)

    with pytest.raises(ModelUnavailable):
        await _made(handler).rerank("问", ["甲"], top_n=1)


async def test_a_reply_this_dialect_cannot_read_points_at_the_dialect() -> None:
    """⚠ 解不动几乎总是方言配错了，重试一万次也一样——故它不该短路。"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"output": {"results": []}}, request=request
        )

    with pytest.raises(ModelRejected) as caught:
        await _made(handler).rerank("问", ["甲"], top_n=1)
    assert "方言" in caught.value.message


async def test_a_reply_that_is_not_json_is_our_mistake_too() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>502</html>", request=request)

    with pytest.raises(ModelRejected):
        await _made(handler).rerank("问", ["甲"], top_n=1)


def test_the_fixed_endpoint_lane_reports_the_model_it_uses() -> None:
    made = _made(_ok)
    assert made.model == "rerank-1"
    assert made.is_ready is True
