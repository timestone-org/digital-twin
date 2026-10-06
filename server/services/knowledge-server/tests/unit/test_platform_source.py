"""外部系统来源：只收平台路径、认统一信封、内容随 discover 一起回来。"""

from collections.abc import Callable, Mapping
from typing import Any

import httpx
import pytest

from knowledge_server.apps.knowledge.services.sources import (
    PLATFORM_KIND,
    KnowledgeSource,
    PlatformSource,
    SourceUnavailable,
)
from knowledge_server.apps.knowledge.services.sources.platform_source import (
    PAGE_SIZE,
)
from lib.errors import AppError


def _client(
    handler: Callable[[httpx.Request], httpx.Response],
) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url="http://platform",
        transport=httpx.MockTransport(handler),
    )


def _enveloped(rows: list[dict[str, Any]]) -> httpx.Response:
    return httpx.Response(
        200, json={"code": 0, "message": "ok", "data": {"items": rows}}
    )


def _source(
    handler: Callable[[httpx.Request], httpx.Response],
    headers: Mapping[str, str] | None = None,
) -> PlatformSource:
    return PlatformSource(client=_client(handler), headers=headers or {})


async def test_it_reads_the_repo_wide_envelope() -> None:
    """⚠ 认信封而不是认裸数组：本仓全服务同一套 `{code,message,data}`，
    直接当数组读的话，第一次遇到分页响应就整个读不出来。"""

    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return _enveloped([{"row_id": "1", "值": 65}])

    page = await _source(handler).discover({"path": "/api/v1/platform/x"}, None)
    assert len(page.items) == 1
    assert page.items[0].external_ref == "1"


async def test_a_bare_array_payload_also_reads() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(200, json={"code": 0, "data": [{"row_id": "1"}]})

    page = await _source(handler).discover({"path": "/x"}, None)
    assert len(page.items) == 1


async def test_the_content_comes_back_with_the_item() -> None:
    """⚠ 为一行几百字的记录再往回打一次是两倍的往返，而对方那一侧的分页游标
    也未必还能定位到它。"""

    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return _enveloped([{"row_id": "1", "出口温度": 65, "空的": None}])

    page = await _source(handler).discover({"path": "/x"}, None)
    body = page.items[0].content.decode("utf-8")
    assert "出口温度：65" in body
    # 空值不进正文：它们只会稀释检索
    assert "空的" not in body


async def test_the_title_carries_a_suffix() -> None:
    """⚠ 后缀是解析器分派的唯一判据：不带的话，摄取时没有哪一路认得出它。"""

    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return _enveloped([{"row_id": "1", "name": "冷却水"}])

    page = await _source(handler).discover(
        {"path": "/x", "title_field": "name"}, None
    )
    assert page.items[0].title == "冷却水.md"


async def test_a_full_url_is_refused() -> None:
    """⚠ 收 URL 的话，这一格就成了一个可以指向任何内网地址的探针。"""

    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return _enveloped([])

    with pytest.raises(AppError, match="平台路径") as caught:
        await _source(handler).discover(
            {"path": "http://192.168.0.1/admin"}, None
        )
    assert caught.value.code == 40001
    assert caught.value.http_status == 400
    assert caught.value.is_retryable is False


async def test_an_upstream_error_is_retryable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(503)

    with pytest.raises(SourceUnavailable) as caught:
        await _source(handler).discover({"path": "/x"}, None)
    assert caught.value.is_retryable is True


async def test_the_identity_headers_are_forwarded_verbatim() -> None:
    """⚠ 必须逐字原样：解析成 UUID 再转回会归一化，验签当场失败。
    ⚠ 也必须真的转发：不转的话上游按匿名判权限，而知识库就成了越权通道。"""
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.headers))
        return _enveloped([])

    await _source(handler, {"X-Auth-Sig": "abc"}).discover({"path": "/x"}, None)
    assert seen["x-auth-sig"] == "abc"


async def test_a_full_page_means_there_is_more() -> None:
    """⚠ 用「空表即到底」判的话，一次恰好返回空页的中间页会让同步提前收工。"""

    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return _enveloped([{"row_id": str(one)} for one in range(PAGE_SIZE)])

    page = await _source(handler).discover({"path": "/x"}, None)
    assert page.cursor == "2"


async def test_a_short_page_means_the_end() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return _enveloped([{"row_id": "1"}])

    page = await _source(handler).discover({"path": "/x"}, "3")
    assert page.cursor is None


async def test_fetch_refuses_instead_of_returning_nothing() -> None:
    """⚠ 静默给空会让一份空文档进到库里、状态还是 ready。"""

    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return _enveloped([])

    with pytest.raises(AppError) as caught:
        await _source(handler).fetch({}, "private-item-ref")
    assert caught.value.code == 52302
    assert caught.value.is_retryable is False
    assert "private-" not in str(caught.value)


def test_it_satisfies_the_source_protocol() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return _enveloped([])

    made = _source(handler)
    assert isinstance(made, KnowledgeSource)
    assert made.kind == PLATFORM_KIND
    assert made.config_schema()["required"] == ["path"]


@pytest.mark.parametrize(
    ("status", "expected_status", "expected_code", "is_retryable"),
    [
        (401, 401, 42315, False),
        (403, 403, 42314, False),
        (400, 502, 52302, False),
        (404, 502, 52302, False),
        (410, 502, 52302, False),
        (422, 502, 52302, False),
        (501, 502, 52302, False),
        (505, 502, 52302, False),
        (408, 502, 52301, True),
        (429, 502, 52301, True),
        (500, 502, 52301, True),
        (502, 502, 52301, True),
        (503, 502, 52301, True),
        (504, 502, 52301, True),
    ],
)
async def test_upstream_errors_are_safe_domain_responses(
    status: int, expected_status: int, expected_code: int, is_retryable: bool
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text="private-upstream-body")

    async with _client(handler) as client:
        source = PlatformSource(client=client, headers={})
        with pytest.raises(AppError) as caught:
            await source.discover({"path": "/private-platform-path"}, None)
    assert caught.value.http_status == expected_status
    assert caught.value.code == expected_code
    assert caught.value.is_retryable is is_retryable
    assert "private-" not in str(caught.value)


@pytest.mark.parametrize(
    "error_type",
    [
        httpx.ReadTimeout,
        httpx.ConnectError,
        httpx.ReadError,
        httpx.RemoteProtocolError,
    ],
)
async def test_transport_failure_is_safe_without_retrying(
    error_type: type[httpx.TransportError],
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        raise error_type("private-transport-details", request=request)

    async with _client(handler) as client:
        source = PlatformSource(client=client, headers={})
        with pytest.raises(SourceUnavailable) as caught:
            await source.discover({"path": "/private-platform-path"}, None)
    assert len(requests) == 1
    assert caught.value.http_status == 502
    assert caught.value.is_retryable is True
    assert "private-" not in str(caught.value)


async def test_an_invalid_upstream_url_is_not_retryable() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.InvalidURL("private-invalid-url-details")

    async with _client(handler) as client:
        source = PlatformSource(client=client, headers={})
        with pytest.raises(AppError) as caught:
            await source.discover({"path": "/private-platform-path"}, None)
    assert caught.value.code == 52302
    assert caught.value.is_retryable is False
    assert "private-" not in str(caught.value)


@pytest.mark.parametrize(
    "error_type", [httpx.UnsupportedProtocol, httpx.LocalProtocolError]
)
async def test_a_permanent_transport_error_is_not_retryable(
    error_type: type[httpx.TransportError],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error_type("private-protocol-details", request=request)

    async with _client(handler) as client:
        source = PlatformSource(client=client, headers={})
        with pytest.raises(AppError) as caught:
            await source.discover({"path": "/private-platform-path"}, None)
    assert caught.value.code == 52302
    assert caught.value.is_retryable is False
    assert "private-" not in str(caught.value)
