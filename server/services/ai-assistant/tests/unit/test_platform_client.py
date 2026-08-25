"""打 platform 的瘦客户端。

守三条家法：身份头**逐字原样**转发（签名覆盖的是原始字符串，归一化一次就验不过）、
带 traceparent（不带的话链路在这一跳断开）、以及失败一律抛而不是回空清单
（把「取不到点位」读成「没有点位」，助手会对着一屏它以为空的画布下结论）。
"""

from collections.abc import Callable

import httpx
import pytest

from ai_assistant.upstream import PlatformClient, PlatformUnavailable

HEADERS = {
    "X-Auth-User-Id": "01a03634-71b9-7038-880a-ce129b09b7d1",
    "X-Auth-Sig": "abc123",
    "X-Auth-Permissions": "Zm9v",
}

Handler = Callable[[httpx.Request], httpx.Response]


def _client(handler: Handler) -> PlatformClient:
    client = PlatformClient(base_url="http://platform.test", timeout_s=5)
    client.use_transport(httpx.MockTransport(handler))
    return client


def _page(items: list[object]) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "code": 0,
            "message": "ok",
            "trace_id": "t",
            "data": {"items": items, "page": 1, "size": 200, "total": 1},
        },
    )


async def test_points_come_back_as_a_list() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return _page([{"node_key": "s:a", "code": "a", "name": "温度"}])

    got = await _client(handler).search_points(HEADERS, keyword="温度")
    assert len(got) == 1


async def test_the_identity_headers_go_through_verbatim() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return _page([])

    await _client(handler).search_points(HEADERS, keyword="温度")
    # 签名覆盖的是原始字符串；归一化一次就验不过，而报出来的是「签名不符」
    for name, value in HEADERS.items():
        assert seen[name.lower()] == value


async def test_every_call_carries_a_traceparent() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return _page([])

    await _client(handler).list_sources(HEADERS)
    # 不带的话链路在「助手 → platform」这一跳断开，而那一跳正是
    # 「点位到底取没取到」的答案所在
    assert seen.get("traceparent")


async def test_the_keyword_and_source_reach_the_query() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return _page([])

    await _client(handler).search_points(
        HEADERS, keyword="温度", source_id="s1"
    )
    assert seen["q"] == "温度"
    assert seen["source_id"] == "s1"


async def test_a_call_without_a_keyword_omits_it() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return _page([])

    await _client(handler).search_points(HEADERS, page=2)
    assert "q" not in seen
    assert seen["page"] == "2"


async def test_an_upstream_error_is_reported_not_swallowed() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"code": 50001, "message": "挂了"})

    with pytest.raises(PlatformUnavailable) as error:
        await _client(handler).list_sources(HEADERS)
    # 回空清单的话，助手会把「取不到」读成「没有」
    assert "503" in str(error.value)


async def test_a_malformed_envelope_is_reported() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>反代挂了</html>")

    with pytest.raises(PlatformUnavailable):
        await _client(handler).list_sources(HEADERS)


async def test_the_failure_reason_never_leaks_the_endpoint() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"code": 1, "message": "x"})

    with pytest.raises(PlatformUnavailable) as error:
        await _client(handler).list_sources(HEADERS)
    # 这句话会显示在界面上
    assert "platform.test" not in str(error.value)


async def test_validating_a_dashboard_posts_to_the_verb_endpoint() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(f"{request.method} {request.url.path}")
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": {"is_valid": True, "issues": []},
            },
        )

    got = await _client(handler).validate_dashboard(HEADERS, "d1")
    assert seen == ["POST /api/v1/platform/dashboards/d1:validate"]
    assert got == {"is_valid": True, "issues": []}


async def test_the_pool_is_rebuilt_after_it_is_closed() -> None:
    calls: list[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return _page([])

    client = _client(handler)
    await client.list_sources(HEADERS)
    await client.close()
    # 关停钩子跑过之后仍可能有在途调用；重复关不许炸，再用要能自己把池建回来
    await client.close()
    await client.list_sources(HEADERS)
    assert len(calls) == 2


async def test_a_timeout_says_so_plainly() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    with pytest.raises(PlatformUnavailable) as error:
        await _client(handler).list_sources(HEADERS)
    # 「超时」与「回了 500」要分得开：前者查网络，后者查上游
    assert "超时" in str(error.value)


async def test_a_body_that_is_not_a_page_reads_as_empty_not_a_crash() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"code": 0, "message": "ok", "trace_id": "t", "data": []},
        )

    # 上游换了形状时宁可空，也不要在几个文件之外炸出一个看不懂的类型错
    assert await _client(handler).list_sources(HEADERS) == []


async def test_a_page_without_items_reads_as_empty() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": {"page": 1, "size": 200, "total": 0},
            },
        )

    assert await _client(handler).list_sources(HEADERS) == []
