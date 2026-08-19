"""推送客户端的连接池：一个进程一份，跨调用复用，关停时关掉。

⚠ 每次调用现造一个 `httpx.AsyncClient` 再关掉，等于每次调用都重新握一次
TCP 手——而值变化推送每个窗口对**每个有变化的实例**各打一次。
"""

import uuid

import httpx

from opcua_server.apps.instance.services.realtime import RealtimeClient

SERVICE_KEY = "k" * 32
INSTANCE = uuid.UUID("0198f0c0-0000-7000-8000-0000000000e1")


def ok_transport() -> httpx.MockTransport:
    """回固定应答的传输层。"""
    return httpx.MockTransport(
        lambda _request: httpx.Response(200, json={"data": {}})
    )


def build_client() -> RealtimeClient:
    """一个把传输层换成假件的推送客户端。"""
    client = RealtimeClient(
        base_url="http://realtime-test",
        service_key=SERVICE_KEY,
        timeout_s=1.0,
    )
    client._transport = ok_transport()  # 理由 —— 只替传输层
    return client


async def test_two_pushes_go_through_the_same_pool() -> None:
    client = build_client()
    await client.publish(INSTANCE, [])
    pooled = client._client()
    await client.publish(INSTANCE, [])
    assert client._client() is pooled
    assert pooled.is_closed is False


async def test_closing_gives_the_pool_back() -> None:
    client = build_client()
    await client.publish(INSTANCE, [])
    pooled = client._client()
    await client.close()
    assert pooled.is_closed is True


async def test_a_push_after_close_gets_a_fresh_pool() -> None:
    # ⚠ 关停之后值发布器还要冲刷最后一批，那时要的是新池子而不是异常
    client = build_client()
    await client.publish(INSTANCE, [])
    pooled = client._client()
    await client.close()
    assert await client.publish(INSTANCE, []) is True
    assert client._client() is not pooled
