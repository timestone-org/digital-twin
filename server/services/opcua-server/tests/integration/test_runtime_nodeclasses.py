"""节点类别与父子树：上位机 Browse 到的形状必须与管理面说的一致。

⚠ 这一组的价值全在**真实客户端**上。管理面自己说「建了一个 Object」不算数
——它只是在问它自己。只有让 `asyncua.Client` 读回 `NodeClass.Object`、
并顺着 BrowsePath 找到子节点，才算证明形状真的建对了。

⚠ 父节点缺失时**报错而不是挂到根下**：静默改挂点会让上位机按 BrowsePath
寻址时全部落空，而它拿到的错误只是「找不到节点」，与真实原因隔得极远。
"""

import socket
from collections.abc import AsyncIterator
from pathlib import Path
from uuid import uuid4

import pytest
from asyncua import Client, ua

from opcua_server.apps.instance.errors import (
    InstanceStartFailed,
    NodeNotFound,
)
from opcua_server.apps.instance.runtime.addressspace import (
    CUSTOM_NAMESPACE_INDEX,
    NodeDefinition,
    order_by_depth,
)
from opcua_server.apps.instance.runtime.instance import (
    LOOPBACK,
    InstanceSpec,
    RunningInstance,
    SecurityProfile,
)
from opcua_server.apps.instance.runtime.pki import PkiStore

OPEN_PROFILE = SecurityProfile(
    allow_anonymous=True, allow_insecure_transport=True
)

PLANT = NodeDefinition(
    identifier="plant",
    browse_name="Plant",
    node_class="object",
)
LINE = NodeDefinition(
    identifier="plant.line1",
    browse_name="Line1",
    node_class="object",
    parent_identifier="plant",
)
TEMPERATURE = NodeDefinition(
    identifier="plant.line1.temperature",
    browse_name="Temperature",
    data_type="double",
    initial_value=20.5,
    parent_identifier="plant.line1",
)
SERIAL = NodeDefinition(
    identifier="plant.serial",
    browse_name="Serial",
    node_class="property",
    data_type="string",
    initial_value="P-01",
    parent_identifier="plant",
)

TREE = (PLANT, LINE, TEMPERATURE, SERIAL)


def _free_port() -> int:
    """要一个当前空闲的端口。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((LOOPBACK, 0))
        return int(probe.getsockname()[1])


def _node_id(identifier: str) -> str:
    """标识对应的完整 NodeId。

    Args: identifier。
    """
    return f"ns={CUSTOM_NAMESPACE_INDEX};s={identifier}"


def _spec(port: int, *, nodes: tuple[NodeDefinition, ...]) -> InstanceSpec:
    return InstanceSpec(
        instance_id=uuid4(),
        name="plant-tree",
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
    """一台建好整棵树的实例，用完必停。"""
    running = RunningInstance(_spec(_free_port(), nodes=TREE), pki=pki)
    await running.start()
    try:
        yield running
    finally:
        await running.stop()


@pytest.fixture
async def client(instance: RunningInstance) -> AsyncIterator[Client]:
    """一条连上去的真实上位机会话。"""
    async with Client(url=instance.spec.endpoint_url()) as connected:
        yield connected


async def test_object_node_is_really_an_object_for_the_client(
    client: Client,
) -> None:
    """⚠ 建成 Variable 而报成功，是最容易溜过去的一种静默失败。"""
    node_class = await client.get_node(_node_id("plant")).read_node_class()
    assert node_class == ua.NodeClass.Object


async def test_property_node_is_really_a_property_for_the_client(
    client: Client,
) -> None:
    node_class = await client.get_node(
        _node_id("plant.serial")
    ).read_node_class()
    assert node_class == ua.NodeClass.Variable


async def test_variable_under_a_nested_object_is_readable(
    client: Client,
) -> None:
    value = await client.get_node(
        _node_id("plant.line1.temperature")
    ).read_value()
    assert value == pytest.approx(20.5)


async def test_the_tree_is_reachable_by_browse_path(client: Client) -> None:
    """按 BrowsePath 寻址——父子关系挂错时这里会落空。"""
    objects = client.get_objects_node()
    found = await objects.get_child(
        [
            f"{CUSTOM_NAMESPACE_INDEX}:Plant",
            f"{CUSTOM_NAMESPACE_INDEX}:Line1",
            f"{CUSTOM_NAMESPACE_INDEX}:Temperature",
        ]
    )
    assert found.nodeid.to_string() == _node_id("plant.line1.temperature")


async def test_child_hot_added_under_an_object_is_readable_at_once(
    instance: RunningInstance, client: Client
) -> None:
    """在**已打开的会话**上热加子节点，当场可读且不必重连。"""
    before = instance.sessions()[0].session_id
    await instance.add_node(
        NodeDefinition(
            identifier="plant.line1.pressure",
            browse_name="Pressure",
            data_type="int32",
            initial_value=101,
            parent_identifier="plant.line1",
        )
    )
    value = await client.get_node(_node_id("plant.line1.pressure")).read_value()
    assert value == 101
    assert instance.sessions()[0].session_id == before


async def test_removing_an_object_takes_its_subtree_with_it(
    instance: RunningInstance, client: Client
) -> None:
    """⚠ 只删自己会让子节点在库里被级联删掉、地址空间里还留着。"""
    await instance.remove_node("plant.line1")
    with pytest.raises(ua.UaStatusCodeError):
        await client.get_node(_node_id("plant.line1.temperature")).read_value()
    assert "plant.line1" not in instance.node_identifiers()
    assert "plant.line1.temperature" not in instance.node_identifiers()


async def test_removing_an_object_keeps_its_siblings(
    instance: RunningInstance, client: Client
) -> None:
    await instance.remove_node("plant.line1")
    value = await client.get_node(_node_id("plant.serial")).read_value()
    assert value == "P-01"


async def test_hot_add_with_an_unknown_parent_is_rejected(
    instance: RunningInstance,
) -> None:
    """⚠ 不许静默改挂到根下——上位机的 BrowsePath 会整片失效。"""
    orphan = NodeDefinition(
        identifier="plant.orphan",
        browse_name="Orphan",
        data_type="int32",
        parent_identifier="plant.nonexistent",
    )
    with pytest.raises(NodeNotFound, match="父节点"):
        await instance.add_node(orphan)
    assert "plant.orphan" not in instance.node_identifiers()


async def test_building_a_tree_with_a_missing_parent_fails_loudly(
    pki: PkiStore,
) -> None:
    lonely = NodeDefinition(
        identifier="a",
        browse_name="A",
        data_type="int32",
        parent_identifier="missing",
    )
    running = RunningInstance(_spec(_free_port(), nodes=(lonely,)), pki=pki)
    with pytest.raises(NodeNotFound, match="父节点"):
        await running.start()


def test_order_by_depth_puts_parents_first() -> None:
    ordered = order_by_depth([TEMPERATURE, SERIAL, LINE, PLANT])
    placed = [definition.identifier for definition in ordered]
    assert placed.index("plant") < placed.index("plant.line1")
    assert placed.index("plant.line1") < placed.index("plant.line1.temperature")


def test_a_parent_cycle_fails_loudly() -> None:
    """成环时排不出「先父后子」，必须报错而不是死循环。"""
    left = NodeDefinition(
        identifier="left", browse_name="L", parent_identifier="right"
    )
    right = NodeDefinition(
        identifier="right", browse_name="R", parent_identifier="left"
    )
    with pytest.raises(InstanceStartFailed, match="成环"):
        order_by_depth([left, right])
