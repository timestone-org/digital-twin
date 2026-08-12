"""运行中增删节点：CONTEXT.md §6 的热生效档。

⚠ 这一组的价值全在**真实客户端**上：只有让一条已建立的 `asyncua.Client`
会话当场读到新节点、当场读不到已删节点，才算证明了「不重启也生效」。
用管理面自己的读写去验证明不了任何事——那只是在问它自己。
"""

import asyncio
import contextlib
import socket
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from uuid import uuid4

import pytest
from asyncua import Client

from opcua_server.apps.instance.errors import (
    InstanceNotRunning,
    NodeDeleteFailed,
    NodeIdentifierTaken,
    NodeNotFound,
    NodeValueRejected,
)
from opcua_server.apps.instance.runtime.addressspace import (
    CUSTOM_NAMESPACE_INDEX,
    NodeDefinition,
    delete_node,
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
NAMEPLATE = NodeDefinition(
    identifier="plant.nameplate",
    browse_name="Nameplate",
    data_type="string",
    initial_value="P-01",
    is_writable=False,
)


def _free_port() -> int:
    """要一个当前空闲的端口。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((LOOPBACK, 0))
        return int(probe.getsockname()[1])


async def _eventually(predicate: Callable[[], bool]) -> bool:
    """等条件成立，最多等 CONDITION_TIMEOUT_S。

    Args: predicate。
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + CONDITION_TIMEOUT_S
    while loop.time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(CONDITION_POLL_S)
    return predicate()


def _spec(port: int, *, nodes: tuple[NodeDefinition, ...]) -> InstanceSpec:
    return InstanceSpec(
        instance_id=uuid4(),
        name="plant-a",
        port=port,
        namespace_uri="urn:digitaltwin:test",
        host=LOOPBACK,
        nodes=nodes,
        security=OPEN_PROFILE,
    )


@pytest.fixture
def pki(tmp_path: Path) -> PkiStore:
    return PkiStore(tmp_path, valid_days=30)


@pytest.fixture
async def instance(pki: PkiStore) -> AsyncIterator[RunningInstance]:
    """一台起好的实例，用完必停——否则端口会漏到后续用例。"""
    running = RunningInstance(
        _spec(_free_port(), nodes=(TEMPERATURE, NAMEPLATE)), pki=pki
    )
    await running.start()
    try:
        yield running
    finally:
        await running.stop()


PRESSURE = NodeDefinition(
    identifier="plant.pressure",
    browse_name="Pressure",
    data_type="int32",
    initial_value=101,
)


def _node_id(identifier: str) -> str:
    """标识对应的完整 NodeId。

    Args: identifier。
    """
    return f"ns={CUSTOM_NAMESPACE_INDEX};s={identifier}"


async def test_added_node_is_readable_by_a_real_client_without_restart(
    instance: RunningInstance,
) -> None:
    """⚠ 这条是「热生效」成立的唯一证据：不重启，真实客户端当场读到。"""
    async with Client(url=instance.spec.endpoint_url()) as client:
        await instance.add_node(PRESSURE)
        node = client.get_node(_node_id(PRESSURE.identifier))
        assert await node.read_value() == 101


async def test_added_node_shows_up_in_browse_without_restart(
    instance: RunningInstance,
) -> None:
    async with Client(url=instance.spec.endpoint_url()) as client:
        await instance.add_node(PRESSURE)
        children = await client.nodes.objects.get_children()
        names = [str(await child.read_browse_name()) for child in children]
        assert any(PRESSURE.browse_name in name for name in names)


async def test_removed_node_is_gone_for_a_real_client_without_restart(
    instance: RunningInstance,
) -> None:
    """删掉之后同一条会话上立刻读不到——不是等下次重启才生效。"""
    async with Client(url=instance.spec.endpoint_url()) as client:
        node = client.get_node(_node_id(TEMPERATURE.identifier))
        assert await node.read_value() == pytest.approx(20.5)
        await instance.remove_node(TEMPERATURE.identifier)
        with pytest.raises(Exception, match="BadNodeIdUnknown"):
            await node.read_value()


async def test_the_same_session_survives_a_structural_change(
    instance: RunningInstance,
) -> None:
    """⚠ 加点不该踢掉会话——这正是不走重启的理由。"""
    async with Client(url=instance.spec.endpoint_url()) as client:
        assert await _eventually(lambda: instance.registry.count() == 1)
        before = instance.sessions()[0].session_id
        await instance.add_node(PRESSURE)
        await instance.remove_node(PRESSURE.identifier)
        assert instance.sessions()[0].session_id == before
        node = client.get_node(_node_id(NAMEPLATE.identifier))
        assert await node.read_value() == "P-01"


async def test_added_node_is_tracked_in_the_identifier_list(
    instance: RunningInstance,
) -> None:
    await instance.add_node(PRESSURE)
    assert PRESSURE.identifier in instance.node_identifiers()


async def test_removed_node_leaves_no_trace_in_the_map(
    instance: RunningInstance,
) -> None:
    await instance.remove_node(TEMPERATURE.identifier)
    assert TEMPERATURE.identifier not in instance.node_identifiers()
    with pytest.raises(NodeNotFound):
        await instance.read_value(TEMPERATURE.identifier)


async def test_added_node_accepts_writes_through_the_management_face(
    instance: RunningInstance,
) -> None:
    await instance.add_node(PRESSURE)
    assert await instance.write_value(PRESSURE.identifier, 7) == 7
    assert await instance.read_value(PRESSURE.identifier) == 7


async def test_adding_a_duplicate_identifier_is_rejected(
    instance: RunningInstance,
) -> None:
    """⚠ 标识冲突只能报错——现场组态里写死了 NodeId，不能自动改名。"""
    twin = NodeDefinition(
        identifier=TEMPERATURE.identifier,
        browse_name="Other",
        data_type="int32",
    )
    with pytest.raises(NodeIdentifierTaken):
        await instance.add_node(twin)


async def test_a_rejected_duplicate_leaves_the_original_intact(
    instance: RunningInstance,
) -> None:
    twin = NodeDefinition(
        identifier=TEMPERATURE.identifier,
        browse_name="Other",
        data_type="int32",
    )
    with contextlib.suppress(NodeIdentifierTaken):
        await instance.add_node(twin)
    assert await instance.read_value(TEMPERATURE.identifier) == pytest.approx(
        20.5
    )


async def test_adding_a_node_with_an_out_of_range_initial_value_is_rejected(
    instance: RunningInstance,
) -> None:
    overflow = NodeDefinition(
        identifier="plant.overflow",
        browse_name="Overflow",
        data_type="int32",
        initial_value=2**31,
    )
    with pytest.raises(NodeValueRejected):
        await instance.add_node(overflow)
    assert "plant.overflow" not in instance.node_identifiers()


async def test_removing_an_unknown_node_is_rejected(
    instance: RunningInstance,
) -> None:
    with pytest.raises(NodeNotFound):
        await instance.remove_node("nope")


async def test_adding_a_node_to_a_stopped_instance_is_rejected(
    pki: PkiStore,
) -> None:
    running = RunningInstance(_spec(_free_port(), nodes=()), pki=pki)
    with pytest.raises(InstanceNotRunning):
        await running.add_node(PRESSURE)


async def test_removing_a_node_from_a_stopped_instance_is_rejected(
    pki: PkiStore,
) -> None:
    running = RunningInstance(
        _spec(_free_port(), nodes=(TEMPERATURE,)), pki=pki
    )
    with pytest.raises(InstanceNotRunning):
        await running.remove_node(TEMPERATURE.identifier)


async def test_a_node_added_at_runtime_does_not_survive_a_restart(
    pki: PkiStore,
) -> None:
    """运行中加的节点不落库，重启回到 spec——与不变式 2 同源。"""
    spec = _spec(_free_port(), nodes=(TEMPERATURE,))
    running = RunningInstance(spec, pki=pki)
    await running.start()
    await running.add_node(PRESSURE)
    await running.stop()
    await running.start()
    try:
        assert running.node_identifiers() == [TEMPERATURE.identifier]
    finally:
        await running.stop()


async def test_concurrent_adds_are_serialised(
    instance: RunningInstance,
) -> None:
    """并发加点不能互相盖掉——结构改动是串行化的。"""
    definitions = [
        NodeDefinition(
            identifier=f"plant.bulk{index}",
            browse_name=f"Bulk{index}",
            data_type="int32",
            initial_value=index,
        )
        for index in range(8)
    ]
    await asyncio.gather(
        *(instance.add_node(definition) for definition in definitions)
    )
    added = set(instance.node_identifiers())
    assert {definition.identifier for definition in definitions} <= added


async def test_concurrent_add_and_remove_leave_a_consistent_map(
    instance: RunningInstance,
) -> None:
    await instance.add_node(PRESSURE)
    await asyncio.gather(
        instance.remove_node(PRESSURE.identifier),
        instance.add_node(
            NodeDefinition(
                identifier="plant.extra",
                browse_name="Extra",
                data_type="int32",
            )
        ),
    )
    assert PRESSURE.identifier not in instance.node_identifiers()
    assert "plant.extra" in instance.node_identifiers()


async def test_a_failed_delete_puts_the_node_back_in_the_map(
    instance: RunningInstance, monkeypatch: pytest.MonkeyPatch
) -> None:
    """⚠ 地址空间删除失败时映射必须回滚。

    否则管理面以为删了、上位机却还能读到——两边说法不一致，且没人会发现。
    """

    async def _refuse(_server: object, _node: object) -> None:
        raise NodeDeleteFailed("模拟地址空间拒绝删除")

    monkeypatch.setattr(
        "opcua_server.apps.instance.runtime.instance.delete_node", _refuse
    )
    with pytest.raises(NodeDeleteFailed):
        await instance.remove_node(TEMPERATURE.identifier)
    assert TEMPERATURE.identifier in instance.node_identifiers()
    assert await instance.read_value(TEMPERATURE.identifier) == pytest.approx(
        20.5
    )


async def test_a_vanished_node_surfaces_as_a_domain_error_on_write(
    instance: RunningInstance,
) -> None:
    """⚠ 查表与 await 之间被删掉时，抛的必须是本仓的异常。

    给写路径加结构锁能消掉这个窗口，但那会让上位机的常规写值排在结构改动
    后面。选择在边界翻译：`UaStatusCodeError` 既没有本仓错误码，也会把
    asyncua 的内部措辞带进响应 message（api-contract §4.2）。
    """
    node = instance._nodes[TEMPERATURE.identifier]
    await delete_node(instance._require_running(), node)
    with pytest.raises(NodeNotFound):
        await instance.write_value(TEMPERATURE.identifier, 1.0)


async def test_a_vanished_node_surfaces_as_a_domain_error_on_read(
    instance: RunningInstance,
) -> None:
    node = instance._nodes[TEMPERATURE.identifier]
    await delete_node(instance._require_running(), node)
    with pytest.raises(NodeNotFound):
        await instance.read_value(TEMPERATURE.identifier)
