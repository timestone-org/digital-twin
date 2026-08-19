"""匿名授权的内部端点：登记 / 列出 / 注销，打真库。

⚠ 这一层守的是跨服务契约的**本端**：platform-server 的发布态对账照这三个
端点写调用，形状变了那边就静默对不上账——表现是所有公开链接都订不上实时值，
而报错落在别人的日志里。
"""

from typing import Any

import httpx
import pytest
from realtime_hub.settings import INTERNAL_PREFIX

pytestmark = [
    pytest.mark.requires_postgres,
    pytest.mark.usefixtures("_clean"),
]

TOPICS = f"{INTERNAL_PREFIX}/realtime/topics"
GRANTS = f"{INTERNAL_PREFIX}/realtime/public-grants"
TOPIC = "opcua:3fa85f64"
# 64 位十六进制，形状与 SHA-256 的输出逐字一致
TICKET_HASH = "a" * 64
DECLARED: dict[str, Any] = {
    "topic": TOPIC,
    "required_code": "opcua:view",
    "publisher": "opcua-server",
}
GRANT: dict[str, Any] = {
    "ticket_hash": TICKET_HASH,
    "topic": TOPIC,
    "publisher": "opcua-server",
}


async def test_declaring_a_grant_twice_is_idempotent(
    client: httpx.AsyncClient,
) -> None:
    await client.post(TOPICS, json=DECLARED)
    first = await client.post(GRANTS, json=GRANT)
    second = await client.post(GRANTS, json=GRANT)
    assert first.status_code == 200
    # ⚠ 对账每几秒重放一次全集，重复登记是正常路径
    assert second.status_code == 200


async def test_a_grant_on_an_undeclared_topic_is_refused(
    client: httpx.AsyncClient,
) -> None:
    # ⚠ 授权指向一个不存在的主题时，握手会过、订阅会成功、数据永远不来
    refused = await client.post(GRANTS, json=GRANT)
    assert refused.status_code == 404


async def test_a_ticket_itself_is_refused_as_a_hash(
    client: httpx.AsyncClient,
) -> None:
    await client.post(TOPICS, json=DECLARED)
    # ⚠ 收的是指纹不是票据：形状一放松，推送方就会把凭据本身送进来
    refused = await client.post(
        GRANTS, json={**GRANT, "ticket_hash": "a-real-looking-public-token"}
    )
    assert refused.status_code == 400


async def test_the_publisher_can_read_back_its_own_grants(
    client: httpx.AsyncClient,
) -> None:
    await client.post(TOPICS, json=DECLARED)
    await client.post(GRANTS, json=GRANT)

    listed = await client.get(GRANTS, params={"publisher": "opcua-server"})
    assert listed.json()["data"]["ticket_hashes"] == [TICKET_HASH]
    # 别人名下的授权不出现在这里——对账按推送方各管各的
    other = await client.get(GRANTS, params={"publisher": "someone-else"})
    assert other.json()["data"]["ticket_hashes"] == []


async def test_revoking_twice_is_not_an_error(
    client: httpx.AsyncClient,
) -> None:
    await client.post(TOPICS, json=DECLARED)
    await client.post(GRANTS, json=GRANT)

    first = await client.delete(f"{GRANTS}/{TICKET_HASH}")
    second = await client.delete(f"{GRANTS}/{TICKET_HASH}")
    assert first.json()["data"]["is_removed"] is True
    # ⚠ 注销是 at-least-once，重复注销不报错；调用方据 is_removed 对账
    assert second.json()["data"]["is_removed"] is False


async def test_revoking_the_topic_takes_its_grants_with_it(
    client: httpx.AsyncClient,
) -> None:
    await client.post(TOPICS, json=DECLARED)
    await client.post(GRANTS, json=GRANT)

    await client.delete(f"{TOPICS}/{TOPIC}")

    # ⚠ 外键级联：主题没了授权也必须没，否则会留下一条指向不存在主题的授权
    listed = await client.get(GRANTS, params={"publisher": "opcua-server"})
    assert listed.json()["data"]["ticket_hashes"] == []
