"""两份打 auth-server 的客户端的连接池：一个进程一份，跨调用复用，关停时关掉。

⚠ 每次调用现造一个 `httpx.AsyncClient` 再关掉，等于每次调用都重新握一次
TCP 手——而取权限码挂在**每一次 WS 握手与每一次换票**上。
"""

import uuid

import httpx
from realtime_hub.apps.channel.services.code_catalog import CodeCatalog
from realtime_hub.apps.channel.services.user_codes import UserCodeSource

SERVICE_KEY = "k" * 32
USER = uuid.UUID("0198f0c0-0000-7000-8000-0000000000d1")


def ok_transport(body: object) -> httpx.MockTransport:
    """回固定应答的传输层。

    Args: body。
    """
    return httpx.MockTransport(
        lambda _request: httpx.Response(200, json={"data": body})
    )


def user_codes() -> UserCodeSource:
    """一个把传输层换成假件的权限码客户端。"""
    source = UserCodeSource(
        base_url="http://auth-test", service_key=SERVICE_KEY, timeout_s=1.0
    )
    source._transport = ok_transport({"permissions": ["dashboard:view"]})
    return source


def code_catalog() -> CodeCatalog:
    """一个把传输层换成假件的权限码目录客户端。"""
    catalog = CodeCatalog(
        base_url="http://auth-test", service_key=SERVICE_KEY, timeout_s=1.0
    )
    catalog._transport = ok_transport({"codes": ["dashboard:view"]})
    return catalog


async def test_two_handshakes_go_through_the_same_pool() -> None:
    source = user_codes()
    await source.codes_of(USER)
    pooled = source._client()
    await source.codes_of(USER)
    assert source._client() is pooled
    assert pooled.is_closed is False


async def test_two_catalog_reads_go_through_the_same_pool() -> None:
    catalog = code_catalog()
    await catalog.known_codes()
    pooled = catalog._client()
    await catalog.known_codes()
    assert catalog._client() is pooled
    assert pooled.is_closed is False


async def test_closing_gives_the_pool_back() -> None:
    source = user_codes()
    await source.codes_of(USER)
    pooled = source._client()
    await source.close()
    assert pooled.is_closed is True


async def test_a_handshake_after_close_gets_a_fresh_pool() -> None:
    # ⚠ 关停之后仍可能有在途握手，那时要的是一份新池子而不是一个异常
    source = user_codes()
    await source.codes_of(USER)
    pooled = source._client()
    await source.close()
    assert await source.codes_of(USER) == frozenset({"dashboard:view"})
    assert source._client() is not pooled
