"""内部批量面的语义：服务级密钥、逐项回执、实例级失败整条失败。

⚠ 这一组守的是「一项失败不牵连其余项」。调用方一拍要写 1+N 个点位，
其中一个被人删了却让另外 N 个也写不进去的话，现场读到的是一整批陈旧值，
而日志里只有一条「写失败」。
"""

from collections.abc import Callable
from typing import Any
from uuid import uuid4

import httpx
import pytest

from opcua_server.apps.instance.deps import PERM_MANAGE, PERM_OPERATE
from opcua_server.settings import API_PREFIX, INTERNAL_PREFIX, Settings

pytestmark = pytest.mark.requires_postgres

INSTANCES = f"{API_PREFIX}/instances"
RESOLVE = f"{INTERNAL_PREFIX}/opcua/nodes:resolve"
WRITE = f"{INTERNAL_PREFIX}/opcua/nodes:write"
OK = 200
CREATED = 201
BAD_REQUEST = 400
UNAUTHORIZED = 401
NOT_FOUND = 404
CONFLICT = 409

Headers = Callable[..., dict[str, str]]


def _service_headers(settings: Settings) -> dict[str, str]:
    return {"X-Service-Key": settings.edge_service_key.get_secret_value()}


async def _instance(
    client: httpx.AsyncClient, headers: Headers, *, name: str
) -> str:
    response = await client.post(
        INSTANCES,
        json={
            "name": name,
            "namespace_uri": f"urn:test:{name}",
            "security_policies": ["NoSecurity"],
            "is_anonymous_allowed": True,
        },
        headers=headers(PERM_MANAGE),
    )
    assert response.status_code == CREATED, response.text
    return str(response.json()["data"]["id"])


async def _node(
    client: httpx.AsyncClient,
    headers: Headers,
    instance_id: str,
    **overrides: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "identifier": "Recommend",
        "browse_name": "Recommend",
        "data_type": "string",
        "initial_value": "",
        # CurrentRead | CurrentWrite
        "access_level": 3,
    }
    body.update(overrides)
    response = await client.post(
        f"{INSTANCES}/{instance_id}/nodes",
        json=body,
        headers=headers(PERM_MANAGE),
    )
    assert response.status_code == CREATED, response.text
    return dict(response.json()["data"]["node"])


async def _start(
    client: httpx.AsyncClient, headers: Headers, instance_id: str
) -> None:
    started = await client.post(
        f"{INSTANCES}/{instance_id}:start", headers=headers(PERM_OPERATE)
    )
    assert started.status_code == OK, started.text


@pytest.mark.usefixtures("clean_tables")
async def test_internal_endpoints_reject_a_caller_without_the_service_key(
    client: httpx.AsyncClient,
) -> None:
    """没有服务级密钥一律拒绝——fail-closed，不是放行。"""
    response = await client.post(
        RESOLVE, json={"instance_id": str(uuid4()), "ids": [str(uuid4())]}
    )
    assert response.status_code == UNAUTHORIZED


@pytest.mark.usefixtures("clean_tables")
async def test_internal_endpoints_reject_a_wrong_service_key(
    client: httpx.AsyncClient,
) -> None:
    """密钥不符与缺失同等对待。"""
    response = await client.post(
        RESOLVE,
        json={"instance_id": str(uuid4()), "ids": [str(uuid4())]},
        headers={"X-Service-Key": "x" * 48},
    )
    assert response.status_code == UNAUTHORIZED


@pytest.mark.usefixtures("clean_tables")
async def test_resolve_reports_data_type_and_writability(
    client: httpx.AsyncClient, sign_headers: Headers, settings: Settings
) -> None:
    """解析回的是绑定时要校验的那几件事：类型、NodeId、可不可写。"""
    instance_id = await _instance(client, sign_headers, name="resolve-host")
    node = await _node(client, sign_headers, instance_id)
    response = await client.post(
        RESOLVE,
        json={"instance_id": instance_id, "ids": [node["id"]]},
        headers=_service_headers(settings),
    )
    assert response.status_code == OK, response.text
    item = response.json()["data"]["items"][0]
    assert item["is_found"] is True
    assert item["data_type"] == "string"
    assert item["node_id"] == "ns=2;s=Recommend"
    assert item["is_writable"] is True


@pytest.mark.usefixtures("clean_tables")
async def test_resolve_reports_a_missing_node_instead_of_failing(
    client: httpx.AsyncClient, sign_headers: Headers, settings: Settings
) -> None:
    """问一个已经不在的节点是正常问答，不是 404。

    ⚠ 做成 404 的话，批量里一个失效的绑定会毁掉整次问询，页面于是既说不出
    哪一个失效了，也显示不出其余几个是好的。
    """
    instance_id = await _instance(client, sign_headers, name="gone-host")
    node = await _node(client, sign_headers, instance_id)
    gone = str(uuid4())
    response = await client.post(
        RESOLVE,
        json={"instance_id": instance_id, "ids": [node["id"], gone]},
        headers=_service_headers(settings),
    )
    assert response.status_code == OK, response.text
    items = response.json()["data"]["items"]
    # ⚠ 顺序必须与入参一致：调用方按下标对齐才说得清哪一个失效
    assert [item["id"] for item in items] == [node["id"], gone]
    assert [item["is_found"] for item in items] == [True, False]


@pytest.mark.usefixtures("clean_tables")
async def test_resolve_rejects_an_unknown_instance(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    """实例不存在是整条失败：那时没有任何一项答得出来。"""
    response = await client.post(
        RESOLVE,
        json={"instance_id": str(uuid4()), "ids": [str(uuid4())]},
        headers=_service_headers(settings),
    )
    assert response.status_code == NOT_FOUND


@pytest.mark.usefixtures("clean_tables")
async def test_batch_write_lands_every_item(
    client: httpx.AsyncClient, sign_headers: Headers, settings: Settings
) -> None:
    """一次批量把区域推荐与组合时长一起写进去。"""
    instance_id = await _instance(client, sign_headers, name="write-host")
    text_node = await _node(client, sign_headers, instance_id)
    number_node = await _node(
        client,
        sign_headers,
        instance_id,
        identifier="SetA",
        browse_name="SetA",
        data_type="double",
        initial_value=0.0,
    )
    await _start(client, sign_headers, instance_id)
    response = await client.post(
        WRITE,
        json={
            "instance_id": instance_id,
            "items": [
                {"id": text_node["id"], "value": "K11+K12+K14"},
                {"id": number_node["id"], "value": 12.4},
            ],
        },
        headers=_service_headers(settings),
    )
    assert response.status_code == OK, response.text
    data = response.json()["data"]
    assert data["written_count"] == 2
    assert [item["value"] for item in data["items"]] == ["K11+K12+K14", 12.4]


@pytest.mark.usefixtures("clean_tables")
async def test_batch_write_keeps_going_past_a_failing_item(
    client: httpx.AsyncClient, sign_headers: Headers, settings: Settings
) -> None:
    """一项失败不牵连其余项，且失败项必带原因。

    ⚠ 这是内部面存在的理由。公开面一个节点写不进就整条失败，用在发布循环上
    就是「一个点位被删掉 → 全房间的点位一起停在旧值」。
    """
    instance_id = await _instance(client, sign_headers, name="partial-host")
    good = await _node(client, sign_headers, instance_id)
    await _start(client, sign_headers, instance_id)
    response = await client.post(
        WRITE,
        json={
            "instance_id": instance_id,
            "items": [
                {"id": str(uuid4()), "value": "先来一个已经不在的"},
                {"id": good["id"], "value": "K11+K12"},
            ],
        },
        headers=_service_headers(settings),
    )
    assert response.status_code == OK, response.text
    data = response.json()["data"]
    assert data["written_count"] == 1
    missing, written = data["items"]
    assert missing["is_written"] is False
    assert missing["error"]
    assert written["is_written"] is True


@pytest.mark.usefixtures("clean_tables")
async def test_batch_write_reports_a_type_mismatch_on_that_item_only(
    client: httpx.AsyncClient, sign_headers: Headers, settings: Settings
) -> None:
    """类型不符是这一项的失败，不是整批的失败。"""
    instance_id = await _instance(client, sign_headers, name="mismatch-host")
    number_node = await _node(
        client,
        sign_headers,
        instance_id,
        identifier="SetB",
        browse_name="SetB",
        data_type="double",
        initial_value=0.0,
    )
    text_node = await _node(client, sign_headers, instance_id)
    await _start(client, sign_headers, instance_id)
    response = await client.post(
        WRITE,
        json={
            "instance_id": instance_id,
            "items": [
                {"id": number_node["id"], "value": "不是一个数"},
                {"id": text_node["id"], "value": "K11"},
            ],
        },
        headers=_service_headers(settings),
    )
    assert response.status_code == OK, response.text
    data = response.json()["data"]
    assert data["written_count"] == 1
    assert data["items"][0]["is_written"] is False
    assert data["items"][1]["is_written"] is True


@pytest.mark.usefixtures("clean_tables")
async def test_batch_write_fails_whole_when_the_instance_is_stopped(
    client: httpx.AsyncClient, sign_headers: Headers, settings: Settings
) -> None:
    """实例没在跑是整条失败：那时没有任何一项能成。"""
    instance_id = await _instance(client, sign_headers, name="stopped-host")
    node = await _node(client, sign_headers, instance_id)
    response = await client.post(
        WRITE,
        json={
            "instance_id": instance_id,
            "items": [{"id": node["id"], "value": "K11"}],
        },
        headers=_service_headers(settings),
    )
    assert response.status_code == CONFLICT, response.text


@pytest.mark.usefixtures("clean_tables")
async def test_batch_write_replays_the_same_idempotency_key(
    client: httpx.AsyncClient, sign_headers: Headers, settings: Settings
) -> None:
    """同一个幂等键重放，回的是首次结果而不是再写一遍。"""
    instance_id = await _instance(client, sign_headers, name="idem-host")
    node = await _node(client, sign_headers, instance_id)
    await _start(client, sign_headers, instance_id)
    body = {
        "instance_id": instance_id,
        "items": [{"id": node["id"], "value": "K11+K12"}],
    }
    headers = {**_service_headers(settings), "Idempotency-Key": "tick-1"}
    first = await client.post(WRITE, json=body, headers=headers)
    assert first.status_code == OK, first.text
    replay = await client.post(
        WRITE,
        json={
            "instance_id": instance_id,
            "items": [{"id": node["id"], "value": "换成别的"}],
        },
        headers=headers,
    )
    assert replay.status_code == OK, replay.text
    assert replay.json()["data"] == first.json()["data"]


@pytest.mark.usefixtures("clean_tables")
async def test_batch_rejects_an_empty_item_list(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    """空批量是调用方的错，不是一次「什么都没写成功」。"""
    response = await client.post(
        WRITE,
        json={"instance_id": str(uuid4()), "items": []},
        headers=_service_headers(settings),
    )
    assert response.status_code == BAD_REQUEST
