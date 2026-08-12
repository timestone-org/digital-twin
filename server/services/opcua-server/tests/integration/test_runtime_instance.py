"""真实起一台 asyncua 服务器，验生命周期、会话追踪与值读写。

⚠ 端口一律从临时池里取，不硬编码——固定端口会让并行跑的用例互相抢。
⚠ 不用 `sleep` 等状态，用带上限的条件等待：`sleep` 要么让用例慢，要么在
   慢机器上偶发失败，两者都不接受。
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
    InstanceAlreadyRunning,
    InstanceNotRunning,
    InstanceStartFailed,
    NodeNotFound,
    NodeNotWritable,
    NodeValueRejected,
)
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

# 条件等待的上限：本地回环上的会话注销远快于此，超过即视为真的没发生
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


async def test_started_instance_is_really_listening(
    instance: RunningInstance,
) -> None:
    """⚠ 这条守不变式 5：以端口实况为准，不是读标志位。"""
    assert await instance.is_listening()


async def test_stopped_instance_stops_listening(pki: PkiStore) -> None:
    running = RunningInstance(_spec(_free_port(), nodes=()), pki=pki)
    await running.start()
    await running.stop()
    assert not await running.is_listening()


async def test_stopping_twice_is_a_no_op(pki: PkiStore) -> None:
    running = RunningInstance(_spec(_free_port(), nodes=()), pki=pki)
    await running.start()
    await running.stop()
    await running.stop()
    assert not await running.is_listening()


async def test_starting_twice_is_rejected(instance: RunningInstance) -> None:
    with pytest.raises(InstanceAlreadyRunning):
        await instance.start()


async def test_second_instance_on_a_taken_port_fails_loudly(
    instance: RunningInstance, pki: PkiStore
) -> None:
    """端口被占必须响亮失败，且失败的那台不能留下半个可用的壳。

    ⚠ 这里不能断言 `clash.is_listening()` 为假——端口探针回答的是「这个端口
    有没有人在监听」，而它正被前一台占着。端口的独占由端口池保证，探针只
    负责回答「这个端点现在能不能连」。
    """
    clash = RunningInstance(_spec(instance.spec.port, nodes=()), pki=pki)
    with pytest.raises(InstanceStartFailed):
        await clash.start()
    assert clash.node_identifiers() == []
    with pytest.raises(InstanceNotRunning):
        await clash.read_value("anything")


async def test_nodes_are_reachable_by_their_pinned_node_id(
    instance: RunningInstance,
) -> None:
    """⚠ 守不变式 3、4：标识由人给，命名空间索引恒为 2。"""
    async with Client(url=instance.spec.endpoint_url()) as client:
        node = client.get_node(
            f"ns={CUSTOM_NAMESPACE_INDEX};s={TEMPERATURE.identifier}"
        )
        assert await node.read_value() == pytest.approx(20.5)


async def test_write_is_visible_to_a_connected_client(
    instance: RunningInstance,
) -> None:
    await instance.write_value(TEMPERATURE.identifier, 31.25)
    async with Client(url=instance.spec.endpoint_url()) as client:
        node = client.get_node(
            f"ns={CUSTOM_NAMESPACE_INDEX};s={TEMPERATURE.identifier}"
        )
        assert await node.read_value() == pytest.approx(31.25)


async def test_read_value_round_trips(instance: RunningInstance) -> None:
    await instance.write_value(TEMPERATURE.identifier, 7.5)
    assert await instance.read_value(TEMPERATURE.identifier) == pytest.approx(
        7.5
    )


async def test_write_of_a_wrong_type_is_rejected(
    instance: RunningInstance,
) -> None:
    with pytest.raises(NodeValueRejected):
        await instance.write_value(TEMPERATURE.identifier, "热")


async def test_read_only_node_rejects_writes(
    instance: RunningInstance,
) -> None:
    with pytest.raises(NodeNotWritable):
        await instance.write_value(NAMEPLATE.identifier, "P-02")


async def test_unknown_node_is_reported(instance: RunningInstance) -> None:
    with pytest.raises(NodeNotFound):
        await instance.read_value("nope")


async def test_values_are_not_persisted_across_restarts(
    pki: PkiStore,
) -> None:
    """⚠ 守不变式 2：重启回初值是明确语义，不是缺陷。"""
    port = _free_port()
    spec = _spec(port, nodes=(TEMPERATURE,))
    first = RunningInstance(spec, pki=pki)
    await first.start()
    await first.write_value(TEMPERATURE.identifier, 99.0)
    await first.stop()

    second = RunningInstance(spec, pki=pki)
    await second.start()
    try:
        assert await second.read_value(TEMPERATURE.identifier) == pytest.approx(
            20.5
        )
    finally:
        await second.stop()


async def test_node_access_on_a_stopped_instance_is_rejected(
    pki: PkiStore,
) -> None:
    running = RunningInstance(
        _spec(_free_port(), nodes=(TEMPERATURE,)), pki=pki
    )
    with pytest.raises(InstanceNotRunning):
        await running.read_value(TEMPERATURE.identifier)


async def test_connected_client_shows_up_as_a_session(
    instance: RunningInstance,
) -> None:
    """会话追踪的端到端证明：注入点接上了，对端地址也拿到了。"""
    async with Client(url=instance.spec.endpoint_url()):
        assert await _eventually(lambda: instance.registry.count() == 1)
        record = instance.sessions()[0]
        assert record.peer.startswith(LOOPBACK)


async def test_disconnected_client_leaves_no_session(
    instance: RunningInstance,
) -> None:
    async with Client(url=instance.spec.endpoint_url()):
        assert await _eventually(lambda: instance.registry.count() == 1)
    assert await _eventually(lambda: instance.registry.count() == 0)


async def test_sessions_of_two_instances_do_not_mix(
    instance: RunningInstance, pki: PkiStore
) -> None:
    """⚠ 守 CONTEXT §4：连接数绝不跨实例相加。"""
    other = RunningInstance(_spec(_free_port(), nodes=()), pki=pki)
    await other.start()
    try:
        async with Client(url=instance.spec.endpoint_url()):
            assert await _eventually(lambda: instance.registry.count() == 1)
            assert other.registry.count() == 0
    finally:
        await other.stop()


async def test_node_identifiers_are_listed(
    instance: RunningInstance,
) -> None:
    assert instance.node_identifiers() == [
        NAMEPLATE.identifier,
        TEMPERATURE.identifier,
    ]


async def test_stopped_instance_forgets_its_nodes(pki: PkiStore) -> None:
    running = RunningInstance(
        _spec(_free_port(), nodes=(TEMPERATURE,)), pki=pki
    )
    await running.start()
    await running.stop()
    assert running.node_identifiers() == []


async def test_duplicate_identifiers_are_rejected(pki: PkiStore) -> None:
    """⚠ 标识冲突只能报错，不能自动改名——现场组态里写死了它。"""
    twin = NodeDefinition(
        identifier=TEMPERATURE.identifier,
        browse_name="Other",
        data_type="int32",
    )
    running = RunningInstance(
        _spec(_free_port(), nodes=(TEMPERATURE, twin)), pki=pki
    )
    with pytest.raises(Exception, match="重复"):
        await running.start()
    with contextlib.suppress(Exception):
        await running.stop()
