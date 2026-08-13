"""改 access_level 是热生效：实例在跑就当场改运行中地址空间的可写位。

⚠ 收口必须用真实 `asyncua.Client`：管理面自己读写证明不了热生效——只有
另一头的上位机的写当场被放行/拒绝，才算「不重启也生效」。
⚠ 另一半是降级方向显式：热改失败时保存不回滚、实例转待重启，且
`pending_fields` 里必须出现 access_level——静默失效比报错难查一个量级。
"""

import logging
import uuid
from collections.abc import Callable
from typing import Any, cast

import httpx
import pytest
from asyncua import Client, ua

from lib.db import Database
from opcua_server.apps.instance.deps import PERM_MANAGE, PERM_OPERATE, PERM_VIEW
from opcua_server.apps.instance.services.node_service import NodeRuntimeSync
from opcua_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

INSTANCES = f"{API_PREFIX}/instances"
LOOPBACK = "127.0.0.1"
OK = 200
CREATED = 201
CONFLICT = 409
# OPC UA AccessLevel 位掩码：仅 CurrentRead / CurrentRead|CurrentWrite
READ_ONLY = 1
READ_WRITE = 3

Headers = Callable[..., dict[str, str]]


async def _instance(
    client: httpx.AsyncClient, headers: Headers, *, should_start: bool
) -> tuple[str, str]:
    """建一台实例（可选起动），返回实例 id 与回环上的 endpoint。

    Args: client, headers, should_start。
    """
    created = await client.post(
        INSTANCES,
        json={
            "name": "hot-access-host",
            "namespace_uri": "urn:test:hotaccess",
            "security_policies": ["NoSecurity"],
            "is_anonymous_allowed": True,
        },
        headers=headers(PERM_MANAGE),
    )
    assert created.status_code == CREATED, created.text
    data = created.json()["data"]
    if should_start:
        started = await client.post(
            f"{INSTANCES}/{data['id']}:start", headers=headers(PERM_OPERATE)
        )
        assert started.status_code == OK, started.text
    path = str(data["endpoint_path"]).lstrip("/")
    return str(data["id"]), f"opc.tcp://{LOOPBACK}:{data['port']}/{path}"


async def _node(
    client: httpx.AsyncClient,
    headers: Headers,
    instance_id: str,
    **overrides: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "identifier": "Valve01",
        "browse_name": "Valve",
        "data_type": "int32",
        "initial_value": 7,
        "access_level": READ_WRITE,
    }
    body.update(overrides)
    response = await client.post(
        f"{INSTANCES}/{instance_id}/nodes",
        json=body,
        headers=headers(PERM_MANAGE),
    )
    assert response.status_code == CREATED, response.text
    return dict(response.json()["data"]["node"])


async def _set_access(
    client: httpx.AsyncClient,
    headers: Headers,
    target: tuple[str, str],
    level: int,
) -> httpx.Response:
    """改一个节点的 access_level。

    Args: client, headers, target（实例与节点 id）, level。
    """
    instance_id, node_id = target
    return await client.put(
        f"{INSTANCES}/{instance_id}/nodes/{node_id}",
        json={"access_level": level},
        headers=headers(PERM_MANAGE),
    )


@pytest.mark.usefixtures("clean_tables")
async def test_lowering_access_level_blocks_a_live_client_write_at_once(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """⚠ 收掉可写位后，同一条上位机会话的写必须当场被拒——不等重启。"""
    instance_id, endpoint = await _instance(
        client, sign_headers, should_start=True
    )
    node = await _node(client, sign_headers, instance_id)
    async with Client(url=endpoint) as upstream:
        handle = upstream.get_node(str(node["node_id"]))
        await handle.write_value(ua.Variant(11, ua.VariantType.Int32))
        saved = await _set_access(
            client, sign_headers, (instance_id, str(node["id"])), READ_ONLY
        )
        assert saved.status_code == OK, saved.text
        assert saved.json()["data"]["pending_fields"] == []
        with pytest.raises(ua.UaStatusCodeError, match="BadUserAccessDenied"):
            await handle.write_value(ua.Variant(22, ua.VariantType.Int32))


@pytest.mark.usefixtures("clean_tables")
async def test_a_failed_hot_apply_degrades_to_pending_restart(
    client: httpx.AsyncClient,
    sign_headers: Headers,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """⚠ 降级方向显式：实例转待重启、pending_fields 如实上报、留一条告警。"""
    instance_id, _ = await _instance(client, sign_headers, should_start=True)
    node = await _node(client, sign_headers, instance_id)

    async def _refuse(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("模拟地址空间拒绝改写")

    monkeypatch.setattr(
        "opcua_server.apps.instance.runtime.instance."
        "RunningInstance.set_node_writable",
        _refuse,
    )
    with caplog.at_level(logging.WARNING):
        saved = await _set_access(
            client, sign_headers, (instance_id, str(node["id"])), READ_ONLY
        )
    assert saved.status_code == OK, saved.text
    assert saved.json()["data"]["pending_fields"] == ["access_level"]
    assert "opcua_access_rewrite_degraded" in caplog.text
    detail = await client.get(
        f"{INSTANCES}/{instance_id}", headers=sign_headers(PERM_VIEW)
    )
    assert detail.json()["data"]["has_pending_restart"] is True


@pytest.mark.usefixtures("clean_tables")
async def test_access_level_saved_while_stopped_reports_nothing_pending(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """没在跑就无所谓热改：下次起来读的就是新配置，pending 必须是空表。"""
    instance_id, _ = await _instance(client, sign_headers, should_start=False)
    node = await _node(
        client, sign_headers, instance_id, access_level=READ_ONLY
    )
    saved = await _set_access(
        client, sign_headers, (instance_id, str(node["id"])), READ_WRITE
    )
    assert saved.status_code == OK, saved.text
    assert saved.json()["data"]["pending_fields"] == []


@pytest.mark.usefixtures("clean_tables")
async def test_raising_access_level_frees_a_live_client_write_at_once(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """放开可写位后，同一条上位机会话当场写得进去。"""
    instance_id, endpoint = await _instance(
        client, sign_headers, should_start=True
    )
    node = await _node(
        client, sign_headers, instance_id, access_level=READ_ONLY
    )
    async with Client(url=endpoint) as upstream:
        handle = upstream.get_node(str(node["node_id"]))
        with pytest.raises(ua.UaStatusCodeError, match="BadUserAccessDenied"):
            await handle.write_value(ua.Variant(11, ua.VariantType.Int32))
        saved = await _set_access(
            client, sign_headers, (instance_id, str(node["id"])), READ_WRITE
        )
        assert saved.json()["data"]["pending_fields"] == []
        await handle.write_value(ua.Variant(22, ua.VariantType.Int32))
        assert await handle.read_value() == 22


@pytest.mark.usefixtures("clean_tables")
async def test_hot_applied_access_level_governs_the_management_write_too(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """⚠ 运行表里的定义必须跟着换：留着旧的 is_writable，管理面还照旧放行。"""
    instance_id, _ = await _instance(client, sign_headers, should_start=True)
    node = await _node(client, sign_headers, instance_id)
    await _set_access(
        client, sign_headers, (instance_id, str(node["id"])), READ_ONLY
    )
    refused = await client.post(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}:write",
        json={"value": 33},
        headers=sign_headers(PERM_OPERATE),
    )
    assert refused.status_code == CONFLICT
    # 42109 = NodeNotWritable：可写位由热改后的定义说了算
    assert refused.json()["code"] == 42109


@pytest.mark.usefixtures("clean_tables")
async def test_a_failed_hot_apply_keeps_the_saved_access_level(
    client: httpx.AsyncClient,
    sign_headers: Headers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """热改失败不回滚保存：值是合法的，错的只是「还没生效」。"""
    instance_id, _ = await _instance(client, sign_headers, should_start=True)
    node = await _node(client, sign_headers, instance_id)

    async def _refuse(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("模拟地址空间拒绝改写")

    monkeypatch.setattr(
        "opcua_server.apps.instance.runtime.instance."
        "RunningInstance.set_node_writable",
        _refuse,
    )
    await _set_access(
        client, sign_headers, (instance_id, str(node["id"])), READ_ONLY
    )
    stored = await client.get(
        f"{INSTANCES}/{instance_id}/nodes/{node['id']}",
        headers=sign_headers(PERM_VIEW),
    )
    assert stored.json()["data"]["access_level"] == READ_ONLY


@pytest.mark.usefixtures("clean_tables")
async def test_access_level_saved_while_stopped_applies_on_next_start(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """停机时保存的可写位，下次起来对上位机就是生效的。"""
    instance_id, endpoint = await _instance(
        client, sign_headers, should_start=False
    )
    node = await _node(
        client, sign_headers, instance_id, access_level=READ_ONLY
    )
    await _set_access(
        client, sign_headers, (instance_id, str(node["id"])), READ_WRITE
    )
    started = await client.post(
        f"{INSTANCES}/{instance_id}:start", headers=sign_headers(PERM_OPERATE)
    )
    assert started.status_code == OK, started.text
    async with Client(url=endpoint) as upstream:
        handle = upstream.get_node(str(node["node_id"]))
        await handle.write_value(ua.Variant(44, ua.VariantType.Int32))
        assert await handle.read_value() == 44


@pytest.mark.usefixtures("clean_tables")
async def test_object_node_access_level_change_is_a_quiet_no_op(
    client: httpx.AsyncClient, sign_headers: Headers
) -> None:
    """object 节点没有值属性，热改对它是 no-op——不炸、也不假装待重启。"""
    instance_id, _ = await _instance(client, sign_headers, should_start=True)
    node = await _node(
        client,
        sign_headers,
        instance_id,
        identifier="Plant",
        browse_name="Plant",
        node_class="object",
        data_type=None,
        initial_value=None,
        access_level=READ_ONLY,
    )
    saved = await _set_access(
        client, sign_headers, (instance_id, str(node["id"])), READ_WRITE
    )
    assert saved.status_code == OK, saved.text
    assert saved.json()["data"]["pending_fields"] == []
    detail = await client.get(
        f"{INSTANCES}/{instance_id}", headers=sign_headers(PERM_VIEW)
    )
    assert detail.json()["data"]["has_pending_restart"] is False


class _RefusingRunning:
    """set_node_writable 一调就炸的运行实例替身。"""

    async def set_node_writable(
        self, _identifier: str, *, is_writable: bool
    ) -> None:
        raise RuntimeError(f"模拟热改失败 is_writable={is_writable}")


class _RefusingSupervisor:
    """永远给出会拒绝热改的实例。"""

    def find(self, _instance_id: object) -> _RefusingRunning:
        return _RefusingRunning()


async def test_a_degraded_rewrite_tolerates_a_vanished_instance_row(
    database: Database,
) -> None:
    """降级要写的实例行已不在时不炸——行没了说明整台实例已删。"""
    sync = NodeRuntimeSync(
        database=database, supervisor=cast(Any, _RefusingSupervisor())
    )
    applied = await sync.rewrite_access(uuid.uuid4(), "ghost", is_writable=True)
    assert applied is False
