"""打 hub 内部端点的调用形状：路径、服务级密钥、traceparent、失败不抛。

⚠ 这一层**不重试**：一条链路只有一层负责重试，而重试归上层的发布循环——
逐层重试会相乘成雪崩（runtime-resilience §4.2）。
"""

import json
from typing import Any

import httpx

from lib.logging import current_traceparent
from platform_server.realtime import (
    GRANTS_PATH,
    PUBLISH_PATH,
    TOPICS_PATH,
    RealtimeClient,
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


async def test_declaring_a_grant_posts_the_fingerprint_not_the_token() -> None:
    calls: list[httpx.Request] = []
    client = build_client(recorder(calls))

    is_declared = await client.declare_grant(
        ticket_hash="a" * 64, topic=TOPIC, publisher="platform-x"
    )

    assert is_declared is True
    body = json.loads(calls[0].content)
    assert calls[0].url.path == GRANTS_PATH
    # ⚠ 送指纹不送令牌：令牌是可直接使用的凭据，不该在两个服务之间来回走
    assert body == {
        "ticket_hash": "a" * 64,
        "topic": TOPIC,
        "publisher": "platform-x",
    }


async def test_listing_grants_asks_for_this_publisher_only() -> None:
    calls: list[httpx.Request] = []
    client = build_client(
        recorder(calls, body={"data": {"ticket_hashes": ["a" * 64]}})
    )

    hashes = await client.grants("platform-x")

    assert hashes == ["a" * 64]
    assert calls[0].url.params["publisher"] == "platform-x"


async def test_an_unreachable_hub_yields_an_empty_grant_list() -> None:
    # ⚠ 空清单只会导致补登记（幂等），不会导致注销——注销以 hub 的清单为输入
    client = build_client(recorder([], status_code=503))

    assert await client.grants("platform-x") == []


async def test_a_malformed_grant_envelope_is_not_read_as_empty() -> None:
    # 信封变形时要响亮失败并按「这一轮问不到」处理，而不是让空集合流下去
    client = build_client(recorder([], body={"data": {"nope": []}}))

    assert await client.grants("platform-x") == []


async def test_revoking_a_grant_deletes_by_fingerprint() -> None:
    calls: list[httpx.Request] = []
    client = build_client(recorder(calls))

    is_revoked = await client.revoke_grant("b" * 64)

    assert is_revoked is True
    assert calls[0].method == "DELETE"
    assert calls[0].url.path == f"{GRANTS_PATH}/{'b' * 64}"


async def test_a_failed_grant_revoke_is_reported_as_such() -> None:
    # ⚠ 失败必须被看见：一条已经撤回的公开链接还能收实时值
    client = build_client(recorder([], status_code=500))

    assert await client.revoke_grant("b" * 64) is False
