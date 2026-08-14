"""打 hub 内部端点的调用形状：路径、服务级密钥、traceparent、失败不抛。

⚠ 这一层**不重试**：一条链路只有一层负责重试，而重试归上层的发布循环——
逐层重试会相乘成雪崩（runtime-resilience §4.2）。
"""

import json
from typing import Any

import httpx

from platform_server.realtime import (
    PUBLISH_PATH,
    TOPICS_PATH,
    RealtimeClient,
    current_traceparent,
)

SERVICE_KEY = "k" * 32
TOPIC = "dashboard:0198f0c0-0000-7000-8000-0000000000a1"


def build_client(
    handler: httpx.MockTransport,
) -> RealtimeClient:
    """一个把传输层换成假件的客户端。

    Args: handler。
    """
    client = RealtimeClient(
        base_url="http://realtime-test",
        service_key=SERVICE_KEY,
        timeout_s=1.0,
    )
    client._transport = handler  # 理由 —— 只替传输层，调用形状仍是真的
    return client


def recorder(
    calls: list[httpx.Request], *, status_code: int = 200, body: Any = None
) -> httpx.MockTransport:
    """记下每一次请求并回固定应答。

    Args: calls, status_code, body。
    """

    def handle(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(status_code, json=body or {"data": {}})

    return httpx.MockTransport(handle)


async def test_declaring_a_topic_posts_the_code_it_requires() -> None:
    calls: list[httpx.Request] = []
    client = build_client(recorder(calls))
    is_declared = await client.declare(
        topic=TOPIC, required_code="dashboard:view", publisher="platform-x"
    )
    assert is_declared is True
    assert calls[0].url.path == TOPICS_PATH
    assert json.loads(calls[0].content) == {
        "topic": TOPIC,
        "required_code": "dashboard:view",
        "publisher": "platform-x",
    }


async def test_every_call_carries_the_service_key() -> None:
    # ⚠ 少了它 hub 一律 401：推送端点挡的正是「任何人」
    calls: list[httpx.Request] = []
    await build_client(recorder(calls)).revoke(TOPIC)
    assert calls[0].headers["x-service-key"] == SERVICE_KEY


async def test_every_call_carries_a_traceparent() -> None:
    calls: list[httpx.Request] = []
    await build_client(recorder(calls)).publish(topic=TOPIC, items=[])
    assert calls[0].headers["traceparent"].startswith("00-")


async def test_the_callers_traceparent_wins_over_the_current_context() -> None:
    calls: list[httpx.Request] = []
    given = "00-11111111111111111111111111111111-2222222222222222-01"
    await build_client(recorder(calls)).publish(
        topic=TOPIC, items=[], traceparent=given
    )
    assert calls[0].headers["traceparent"] == given


async def test_publishing_sends_the_items_as_given() -> None:
    calls: list[httpx.Request] = []
    items = [{"nodeKey": "a:b", "state": "ok"}]
    await build_client(recorder(calls)).publish(topic=TOPIC, items=items)
    assert calls[0].url.path == PUBLISH_PATH
    assert json.loads(calls[0].content) == {"topic": TOPIC, "items": items}


async def test_a_rejected_publish_is_reported_as_failure_not_raised() -> None:
    # hub 不可达降级为「没有实时通道」，绝不降级为「大屏打不开」
    calls: list[httpx.Request] = []
    client = build_client(recorder(calls, status_code=503))
    assert await client.publish(topic=TOPIC, items=[]) is False


async def test_a_failed_call_is_not_retried() -> None:
    calls: list[httpx.Request] = []
    client = build_client(recorder(calls, status_code=500))
    await client.publish(topic=TOPIC, items=[])
    assert len(calls) == 1


async def test_revoking_a_topic_deletes_it_by_name() -> None:
    calls: list[httpx.Request] = []
    is_revoked = await build_client(recorder(calls)).revoke(TOPIC)
    assert is_revoked is True
    assert calls[0].method == "DELETE"
    assert calls[0].url.path == f"{TOPICS_PATH}/{TOPIC}"


async def test_a_failed_revoke_is_reported_so_the_next_round_retries() -> None:
    calls: list[httpx.Request] = []
    client = build_client(recorder(calls, status_code=503))
    assert await client.revoke(TOPIC) is False


async def test_the_topic_list_comes_back_as_the_hub_reported_it() -> None:
    calls: list[httpx.Request] = []
    client = build_client(
        recorder(calls, body={"data": {"publisher": "p", "topics": [TOPIC]}})
    )
    assert await client.topics("platform-publisher") == [TOPIC]
    assert calls[0].url.params["publisher"] == "platform-publisher"


async def test_an_unreachable_hub_lists_no_topics_instead_of_raising() -> None:
    # ⚠ 空清单只会导致补登记，不会导致注销——这个不对称是刻意的
    calls: list[httpx.Request] = []
    client = build_client(recorder(calls, status_code=503))
    assert await client.topics("platform-publisher") == []


async def test_a_reshaped_envelope_lands_in_the_same_bucket_as_a_failure() -> (
    None
):
    # 信封变形与 hub 不可达对对账是同一件事：这一轮问不到，只补登记不注销
    calls: list[httpx.Request] = []
    client = build_client(recorder(calls, body={"topics": [TOPIC]}))
    assert await client.topics("platform-publisher") == []


def test_the_traceparent_has_the_shape_the_hub_passes_through() -> None:
    parts = current_traceparent().split("-")
    assert parts[0] == "00"
    assert len(parts[1]) == 32
    assert len(parts[2]) == 16
    assert parts[3] == "01"
