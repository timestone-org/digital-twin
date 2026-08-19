"""两份内部 HTTP 客户端的连接池：一个进程一份，跨调用复用，关停时关掉。

⚠ 每次调用现造一个 `httpx.AsyncClient` 再关掉，等于每次调用都重新握一次
TCP 手——而 publisher 每一拍、每张在看的大屏、每一片都要打一次 hub。
"""

import uuid

import httpx

from platform_server.opcua import OpcuaClient
from platform_server.realtime import RealtimeClient

SERVICE_KEY = "k" * 32
TOPIC = "dashboard:0198f0c0-0000-7000-8000-0000000000a1"
INSTANCE = uuid.UUID("0198f0c0-0000-7000-8000-0000000000c1")
NODE = uuid.UUID("0198f0c0-0000-7000-8000-0000000000c2")


def ok_transport(body: object) -> httpx.MockTransport:
    """回固定应答的传输层。

    Args: body。
    """
    return httpx.MockTransport(
        lambda _request: httpx.Response(200, json={"data": body})
    )


def realtime_client() -> RealtimeClient:
    """一个把传输层换成假件的 hub 客户端。"""
    client = RealtimeClient(
        base_url="http://realtime-test",
        service_key=SERVICE_KEY,
        timeout_s=1.0,
    )
    client._transport = ok_transport({})  # 理由 —— 只替传输层
    return client


def opcua_client() -> OpcuaClient:
    """一个把传输层换成假件的 opcua-server 客户端。"""
    client = OpcuaClient(
        base_url="http://opcua-test", service_key=SERVICE_KEY, timeout_s=1.0
    )
    client._transport = ok_transport({"items": []})  # 理由 —— 只替传输层
    return client


async def test_two_pushes_go_through_the_same_pool() -> None:
    client = realtime_client()
    await client.publish(topic=TOPIC, items=[])
    pooled = client._client()
    await client.publish(topic=TOPIC, items=[])
    assert client._client() is pooled
    assert pooled.is_closed is False


async def test_two_resolves_go_through_the_same_pool() -> None:
    client = opcua_client()
    await client.resolve(instance_id=INSTANCE, node_ids=[NODE])
    pooled = client._client()
    await client.resolve(instance_id=INSTANCE, node_ids=[NODE])
    assert client._client() is pooled
    assert pooled.is_closed is False


async def test_closing_gives_the_pool_back() -> None:
    client = realtime_client()
    await client.publish(topic=TOPIC, items=[])
    pooled = client._client()
    await client.close()
    assert pooled.is_closed is True


async def test_a_call_after_close_gets_a_fresh_pool() -> None:
    # ⚠ 关停之后仍可能有在途调用，那时要的是一份新池子而不是一个异常
    client = realtime_client()
    await client.publish(topic=TOPIC, items=[])
    pooled = client._client()
    await client.close()
    assert await client.publish(topic=TOPIC, items=[]) is True
    assert client._client() is not pooled
