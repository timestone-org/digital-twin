"""拉目录的客户端与缓存：带服务级密钥去、按 TTL 缓存、拉不到就沿用旧的。

守的是两件运行期看不出的事：平台抖一下**不许**把手上的目录清成空（那会让
所有会话忽然退回环境变量那一档），以及同一时刻并发的刷新只打平台一次。
"""

import asyncio
import json
from typing import Any

import httpx
import pytest

from llmcore import (
    CATALOG_PATH,
    CatalogCache,
    CatalogClient,
    CatalogUnavailable,
)

KEY = "k" * 32


def _body(version: str = "v1") -> dict[str, Any]:
    return {
        "code": 0,
        "message": "ok",
        "trace_id": "t",
        "data": {
            "version": version,
            "providers": [
                {
                    "id": "p1",
                    "name": "百炼",
                    "base_url": "https://endpoint/v1",
                    "api_key": "sk-secret",
                    "is_enabled": True,
                    "models": [{"name": "chat-1", "kind": "chat"}],
                }
            ],
            "assignments": [
                {
                    "purpose": "a.chat",
                    "provider_id": "p1",
                    "model_name": "chat-1",
                }
            ],
        },
    }


class _Upstream:
    """假平台：记下每次请求，按预置的应答序列回。"""

    def __init__(self, *responses: httpx.Response | Exception) -> None:
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = (
            self.responses.pop(0)
            if len(self.responses) > 1
            else (self.responses[0])
        )
        if isinstance(answer, Exception):
            raise answer
        return answer

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)


def _client(upstream: _Upstream) -> CatalogClient:
    made = CatalogClient(
        base_url="http://platform", service_key=KEY, timeout_s=2.0
    )
    made.use_transport(upstream.transport())
    return made


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


async def test_fetch_sends_the_service_key_to_the_catalog_path() -> None:
    upstream = _Upstream(httpx.Response(200, json=_body()))
    catalog = await _client(upstream).fetch()
    request = upstream.requests[0]
    assert request.url.path == CATALOG_PATH
    assert request.headers["X-Service-Key"] == KEY
    assert catalog.version == "v1"
    assert catalog.resolve("a.chat") is not None


@pytest.mark.parametrize(
    "answer",
    [
        httpx.Response(401, json={"code": 40100, "message": "x"}),
        httpx.Response(200, content=b"not json"),
        httpx.Response(200, json={"code": 0, "data": "wrong shape"}),
        httpx.ConnectError("refused"),
    ],
    ids=["rejected", "not-json", "malformed", "unreachable"],
)
async def test_any_failure_is_one_named_error(
    answer: httpx.Response | Exception,
) -> None:
    with pytest.raises(CatalogUnavailable):
        await _client(_Upstream(answer)).fetch()


async def test_the_cache_pulls_once_within_the_ttl() -> None:
    upstream = _Upstream(httpx.Response(200, json=_body()))
    clock = _Clock()
    cache = CatalogCache(_client(upstream), ttl_s=10.0, clock=clock)
    assert cache.snapshot().is_empty
    await cache.refresh()
    await cache.refresh()
    assert len(upstream.requests) == 1
    clock.now += 10.0
    await cache.refresh()
    assert len(upstream.requests) == 2


async def test_force_ignores_the_ttl() -> None:
    upstream = _Upstream(httpx.Response(200, json=_body()))
    cache = CatalogCache(_client(upstream), ttl_s=10.0, clock=_Clock())
    await cache.refresh()
    await cache.refresh(is_forced=True)
    assert len(upstream.requests) == 2


async def test_a_failed_pull_keeps_the_stale_catalog() -> None:
    """⚠ 清空的话，平台抖一下就把所有会话打回环境变量那一档。"""
    upstream = _Upstream(
        httpx.Response(200, json=_body()), httpx.ConnectError("down")
    )
    clock = _Clock()
    cache = CatalogCache(_client(upstream), ttl_s=10.0, clock=clock)
    await cache.refresh()
    clock.now += 10.0
    got = await cache.refresh()
    assert got.resolve("a.chat") is not None
    # 失败也推进时间戳：不推进的话每一次调用都会再打一遍正在挂着的平台
    assert cache.is_stale is False


async def test_concurrent_refreshes_hit_the_platform_once() -> None:
    upstream = _Upstream(httpx.Response(200, json=_body()))
    cache = CatalogCache(_client(upstream), ttl_s=10.0, clock=_Clock())
    await asyncio.gather(*(cache.refresh() for _ in range(5)))
    assert len(upstream.requests) == 1


async def test_the_secret_never_leaks_into_the_version() -> None:
    upstream = _Upstream(httpx.Response(200, json=_body("abc")))
    cache = CatalogCache(_client(upstream), ttl_s=10.0, clock=_Clock())
    got = await cache.refresh()
    assert "sk-secret" not in json.dumps(got.version)
