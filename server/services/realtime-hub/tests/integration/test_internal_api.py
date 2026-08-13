"""内部端点的集成用例：登记 / 注销 / 推送，打真库。

⚠ 这一层守的是跨服务契约的**本端**：opcua-server 照这三个端点写调用，
形状变了那边就静默推不动——而它的报错落在别人的日志里。
"""

from typing import Any

import httpx
import pytest
from realtime_hub.settings import INTERNAL_PREFIX

pytestmark = [
    pytest.mark.requires_postgres,
    # 每条用例后清表；不注入形参，只声明依赖
    pytest.mark.usefixtures("_clean"),
]

TOPICS = f"{INTERNAL_PREFIX}/realtime/topics"
PUBLISH = f"{INTERNAL_PREFIX}/realtime/publish"
DECLARED: dict[str, Any] = {
    "topic": "opcua:3fa85f64",
    "required_code": "opcua:view",
    "publisher": "opcua-server",
}


async def test_declaring_a_topic_twice_with_the_same_code_is_idempotent(
    client: httpx.AsyncClient,
) -> None:
    first = await client.post(TOPICS, json=DECLARED)
    second = await client.post(TOPICS, json=DECLARED)
    assert first.status_code == 200
    # ⚠ 幂等：注销走 at-least-once，推送方重试是正常路径
    assert second.status_code == 200


async def test_declaring_the_same_topic_with_another_code_conflicts(
    client: httpx.AsyncClient,
) -> None:
    await client.post(TOPICS, json=DECLARED)
    clash = await client.post(
        TOPICS, json={**DECLARED, "required_code": "opcua:manage"}
    )
    # 两个推送方抢同一个主题：放过去，订阅授权就成了「谁先登记算谁的」
    assert clash.status_code == 409


async def test_an_unknown_permission_code_is_refused(
    client: httpx.AsyncClient,
) -> None:
    refused = await client.post(
        TOPICS, json={**DECLARED, "required_code": "nope:nope"}
    )
    assert refused.status_code == 400


async def test_revoking_reports_whether_a_row_was_removed(
    client: httpx.AsyncClient,
) -> None:
    await client.post(TOPICS, json=DECLARED)
    first = await client.delete(f"{TOPICS}/{DECLARED['topic']}")
    second = await client.delete(f"{TOPICS}/{DECLARED['topic']}")
    assert first.json()["data"]["is_removed"] is True
    # ⚠ 重复注销不报错，只是 is_removed 为假——推送方据它对账
    assert second.status_code == 200
    assert second.json()["data"]["is_removed"] is False


async def test_publishing_allocates_a_monotonic_seq(
    client: httpx.AsyncClient,
) -> None:
    await client.post(TOPICS, json=DECLARED)
    seqs = []
    for _round in range(3):
        response = await client.post(
            PUBLISH, json={"topic": DECLARED["topic"], "items": [{"v": 1}]}
        )
        seqs.append(response.json()["data"]["seq"])
    # ⚠ 单调且不重号：客户端据 seq 发现丢帧，重号会被当成重复丢弃
    assert seqs == [1, 2, 3]


async def test_publishing_to_an_undeclared_topic_fails_loudly(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post(
        PUBLISH, json={"topic": "opcua:never", "items": []}
    )
    assert response.status_code == 404


async def test_an_oversized_payload_is_refused_rather_than_split(
    client: httpx.AsyncClient,
) -> None:
    # ⚠ 分片是推送方的事：hub 一旦知道「哪些载荷可以拆」就长出业务知识了
    await client.post(TOPICS, json=DECLARED)
    response = await client.post(
        PUBLISH,
        json={
            "topic": DECLARED["topic"],
            "items": [{"v": index} for index in range(1000)],
        },
    )
    assert response.status_code == 413


async def test_every_internal_endpoint_requires_the_service_key(
    client: httpx.AsyncClient,
) -> None:
    for method, url, body in (
        ("POST", TOPICS, DECLARED),
        ("POST", PUBLISH, {"topic": "x", "items": []}),
    ):
        response = await client.request(
            method, url, json=body, headers={"X-Service-Key": "wrong"}
        )
        assert response.status_code == 401


async def test_unknown_fields_are_refused(
    client: httpx.AsyncClient,
) -> None:
    # ⚠ 推送方把字段名拼错时要响亮失败，而不是静静地不生效。
    # 本仓把入参校验统一映射成 400（不是 FastAPI 默认的 422），见 lib.errors
    response = await client.post(TOPICS, json={**DECLARED, "extra": 1})
    assert response.status_code == 400


async def test_topics_can_be_listed_for_reconciliation(
    client: httpx.AsyncClient,
) -> None:
    """⚠ 对账要的是全集：推送方拿它比对自己的实体表，补缺、清多。"""
    await client.post(TOPICS, json=DECLARED)
    await client.post(TOPICS, json={**DECLARED, "topic": "opcua:another"})
    response = await client.get(TOPICS, params={"publisher": "opcua-server"})
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["publisher"] == "opcua-server"
    assert set(payload["topics"]) == {DECLARED["topic"], "opcua:another"}


async def test_listing_another_publisher_returns_nothing(
    client: httpx.AsyncClient,
) -> None:
    # ⚠ 按推送方隔离：A 的对账不该看见也不该清掉 B 的主题
    await client.post(TOPICS, json=DECLARED)
    response = await client.get(TOPICS, params={"publisher": "someone-else"})
    assert response.json()["data"]["topics"] == []
