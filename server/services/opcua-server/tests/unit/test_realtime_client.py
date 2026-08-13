"""hub 客户端：调用形状，以及 hub 不可达时的降级方向。

⚠ 这一层守的是「降级方向逐项显式」：hub 挂了必须仍然能建实例、能删实例，
只是少一个实时通道。反过来（hub 挂了就建不了实例）是把一条**可选**链路
变成了硬依赖。
"""

import uuid

import httpx

from opcua_server.apps.instance.services.realtime import (
    TOPIC_REQUIRED_CODE,
    RealtimeClient,
    topic_of,
)

INSTANCE = uuid.UUID("3fa85f64-5717-4562-b3fc-2c963f66afa6")


def _client(handler: object) -> RealtimeClient:
    client = RealtimeClient(
        base_url="http://hub-test", service_key="k" * 32, timeout_s=1.0
    )
    client._transport = httpx.MockTransport(handler)  # type: ignore[attr-defined]  # 测试注入
    return client


def test_the_topic_name_follows_the_contract_shape() -> None:
    # api-contract §10：`<域>:<标识>`，域名与 REST 资源名一致
    assert topic_of(INSTANCE) == f"opcua:{INSTANCE}"


async def test_declare_sends_the_view_code_and_the_service_key() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers["X-Service-Key"]
        seen["traceparent"] = request.headers.get("traceparent")
        seen["body"] = request.read().decode()
        return httpx.Response(200, json={"data": {}})

    assert await _client(handler).declare(INSTANCE) is True
    assert seen["key"] == "k" * 32
    # ⚠ traceparent 必须带：hub 把它原样放进扇出信封，不带就断链
    assert seen["traceparent"]
    assert TOPIC_REQUIRED_CODE in str(seen["body"])


async def test_declare_reports_failure_instead_of_raising() -> None:
    # ⚠ 不抛：抛的话建实例会因为 hub 挂了而失败
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    assert await _client(handler).declare(INSTANCE) is False


async def test_a_server_error_is_also_a_soft_failure() -> None:
    handler = httpx.Response(500, json={"message": "boom"})
    assert await _client(lambda _request: handler).declare(INSTANCE) is False


async def test_revoke_targets_the_topic_and_never_raises() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"data": {}})

    assert await _client(handler).revoke(INSTANCE) is True
    assert topic_of(INSTANCE) in str(seen["url"])


async def test_revoke_failure_does_not_block_deletion() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("hub down")

    # ⚠ 留下一个空主题，但实例删得掉——反过来更糟
    assert await _client(handler).revoke(INSTANCE) is False


async def test_publish_carries_the_items() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.read().decode()
        return httpx.Response(200, json={"data": {"seq": 1}})

    ok = await _client(handler).publish(INSTANCE, [{"identifier": "n1"}])
    assert ok is True
    assert "n1" in str(seen["body"])
