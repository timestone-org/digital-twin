"""opcua-server 回执变形时一律报 `OpcuaCallFailed`。

⚠ 调用方只接 `OpcuaCallFailed`：漏出一个裸的校验错，下发循环就跳过记错与
心跳那一步，表现是「静默没发」；绑定那条路则成了一个未处理的 500。
"""

import uuid

import httpx
import pytest

from platform_server.opcua import NodeWrite, OpcuaCallFailed, OpcuaClient

INSTANCE = uuid.UUID("0198f0c0-0000-7000-8000-0000000000c1")
NODE = uuid.UUID("0198f0c0-0000-7000-8000-0000000000c2")


def client_answering(data: object) -> OpcuaClient:
    """一个回执固定为给定 data 段的客户端。Args: data。"""
    client = OpcuaClient(
        base_url="http://opcua-test", service_key="k" * 32, timeout_s=1.0
    )
    client._transport = httpx.MockTransport(  # 理由 —— 只替传输层
        lambda _request: httpx.Response(200, json={"code": 0, "data": data})
    )
    return client


async def test_a_write_receipt_missing_its_id_is_a_call_failure() -> None:
    client = client_answering({"items": [{"is_written": True}]})
    with pytest.raises(OpcuaCallFailed):
        await client.write(
            instance_id=INSTANCE, items=[NodeWrite(id=NODE, value=1.0)]
        )


async def test_a_resolve_receipt_of_the_wrong_shape_is_a_call_failure() -> None:
    client = client_answering({"items": [{"id": "not-a-uuid"}]})
    with pytest.raises(OpcuaCallFailed):
        await client.resolve(instance_id=INSTANCE, node_ids=[NODE])
