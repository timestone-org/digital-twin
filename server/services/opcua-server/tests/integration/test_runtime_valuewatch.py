"""值变化监听：两条写入路径都要被同一个回调看见。

⚠ 这一组的价值在**真实客户端**那一半：上位机经 opc.tcp 写值不经过管理面的
任何代码，只有让一条真的 `asyncua.Client` 会话写进去、再断言回调收到了，
才算证明了「SCADA 写值前端也能看见」。用管理面自己的写值去验只证明了一半。
"""

import asyncio
import socket
import uuid
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from uuid import uuid4

import pytest
from asyncua import Client

from opcua_server.apps.instance.runtime.addressspace import (
    CUSTOM_NAMESPACE_INDEX,
    NodeDefinition,
)
from opcua_server.apps.instance.runtime.instance import (
    LOOPBACK,
    InstanceSpec,
    RunningInstance,
    SecurityProfile,
)
from opcua_server.apps.instance.runtime.pki import PkiStore

CONDITION_TIMEOUT_S = 5.0
CONDITION_POLL_S = 0.02

OPEN_PROFILE = SecurityProfile(
    allow_anonymous=True, allow_insecure_transport=True
)
TEMPERATURE = NodeDefinition(
    identifier="plant.temperature",
    browse_name="Temperature",
    data_type="double",
    initial_value=20.5,
)

Seen = list[tuple[uuid.UUID, str, object]]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((LOOPBACK, 0))
        return int(probe.getsockname()[1])


async def _eventually(predicate: Callable[[], bool]) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + CONDITION_TIMEOUT_S
    while loop.time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(CONDITION_POLL_S)
    return predicate()


@pytest.fixture
def pki(tmp_path: Path) -> PkiStore:
    return PkiStore(tmp_path, valid_days=30)


@pytest.fixture
async def watched(
    pki: PkiStore,
) -> AsyncIterator[tuple[RunningInstance, Seen]]:
    """一台带值监听的实例，用完必停——否则端口会漏到后续用例。"""
    seen: Seen = []

    async def on_change(
        instance_id: uuid.UUID, identifier: str, value: object
    ) -> None:
        seen.append((instance_id, identifier, value))

    running = RunningInstance(
        InstanceSpec(
            instance_id=uuid4(),
            name="plant-watch",
            port=_free_port(),
            namespace_uri="urn:digitaltwin:test",
            host=LOOPBACK,
            nodes=(TEMPERATURE,),
            security=OPEN_PROFILE,
        ),
        pki=pki,
        on_value_change=on_change,
    )
    await running.start()
    try:
        yield running, seen
    finally:
        await running.stop()


async def test_a_management_write_is_seen(
    watched: tuple[RunningInstance, Seen],
) -> None:
    running, seen = watched
    # ⚠ 订阅建立时 asyncua 会先推一次**当前值**（OPC UA 的标准行为），所以
    # 不能只等「有没有通知」，要等目标值真的到达
    await running.write_value(TEMPERATURE.identifier, 42.5)
    assert await _eventually(lambda: any(item[2] == 42.5 for item in seen))
    assert seen[-1][0] == running.spec.instance_id
    assert seen[-1][1] == TEMPERATURE.identifier


async def test_a_write_from_a_real_client_is_seen(
    watched: tuple[RunningInstance, Seen],
) -> None:
    """⚠ 这条是本组的重点：上位机写值不经过管理面的任何代码。"""
    running, seen = watched
    seen.clear()
    async with Client(url=running.spec.endpoint_url()) as client:
        node = client.get_node(
            f"ns={CUSTOM_NAMESPACE_INDEX};s={TEMPERATURE.identifier}"
        )
        await node.write_value(77.25)
    assert await _eventually(lambda: any(item[2] == 77.25 for item in seen))
    assert seen[-1][1] == TEMPERATURE.identifier


async def test_a_hot_added_node_is_watched_too(
    watched: tuple[RunningInstance, Seen],
) -> None:
    """⚠ 订阅集是在实例启动那一刻定下来的。

    热加的节点不补进去的话，它**永远不会推值**——而热加是文档化的能力，
    表现会是「新加的点在页面上永远不动」，且没有任何报错。
    """
    running, seen = watched
    added = NodeDefinition(
        identifier="plant.pressure",
        browse_name="Pressure",
        data_type="double",
        initial_value=1.0,
    )
    await running.add_node(added)
    seen.clear()
    await running.write_value(added.identifier, 3.25)
    assert await _eventually(lambda: any(item[2] == 3.25 for item in seen))
    assert seen[-1][1] == added.identifier
