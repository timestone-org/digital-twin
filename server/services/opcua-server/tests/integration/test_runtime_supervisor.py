"""多实例 supervisor：数量上限、端口记账、故障隔离。"""

import contextlib
import socket
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from uuid import uuid4

import pytest

from opcua_server.apps.instance.errors import (
    InstanceLimitReached,
    InstanceNotFound,
    InstanceStartFailed,
    PortPoolExhausted,
)
from opcua_server.apps.instance.runtime.instance import (
    LOOPBACK,
    InstanceSpec,
    SecurityProfile,
)
from opcua_server.apps.instance.runtime.pki import PkiStore
from opcua_server.apps.instance.runtime.ports import PortAllocator
from opcua_server.apps.instance.runtime.supervisor import InstanceSupervisor

OPEN_PROFILE = SecurityProfile(
    allow_anonymous=True, allow_insecure_transport=True
)


def _free_ports(count: int) -> tuple[int, ...]:
    """要一批当前空闲的端口。"""
    holders = [
        socket.socket(socket.AF_INET, socket.SOCK_STREAM) for _ in range(count)
    ]
    try:
        ports: list[int] = []
        for holder in holders:
            holder.bind((LOOPBACK, 0))
            ports.append(int(holder.getsockname()[1]))
        return tuple(ports)
    finally:
        for holder in holders:
            holder.close()


@contextlib.contextmanager
def _occupied(port: int) -> Iterator[None]:
    """让池外的程序占住这个端口，模拟「池的配置与现实不符」。

    Args: port。
    """
    holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    holder.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    holder.bind((LOOPBACK, port))
    holder.listen(1)
    try:
        yield
    finally:
        holder.close()


def _spec(port: int, name: str = "plant") -> InstanceSpec:
    return InstanceSpec(
        instance_id=uuid4(),
        name=name,
        port=port,
        namespace_uri="urn:digitaltwin:test",
        host=LOOPBACK,
        security=OPEN_PROFILE,
    )


def supervisor_port(supervisor: InstanceSupervisor, index: int) -> int:
    """从 supervisor 的池里取第 index 个端口。

    Args: supervisor, index。
    """
    return supervisor_pool(supervisor)[index]


def supervisor_pool(supervisor: InstanceSupervisor) -> tuple[int, ...]:
    """supervisor 的端口池。

    Args: supervisor。
    """
    return supervisor.ports.pool


@pytest.fixture
async def supervisor(tmp_path: Path) -> AsyncIterator[InstanceSupervisor]:
    """一台带三个端口的 supervisor，用完全停。"""
    running = InstanceSupervisor(
        ports=PortAllocator(_free_ports(3)),
        pki=PkiStore(tmp_path, valid_days=30),
        max_instances=2,
    )
    try:
        yield running
    finally:
        await running.stop_all()


async def test_started_instance_is_tracked(
    supervisor: InstanceSupervisor,
) -> None:
    spec = _spec(supervisor_port(supervisor, 0))
    await supervisor.start(spec)
    assert supervisor.running_ids() == [spec.instance_id]


async def test_starting_the_same_instance_twice_returns_the_same_object(
    supervisor: InstanceSupervisor,
) -> None:
    spec = _spec(supervisor_port(supervisor, 0))
    first = await supervisor.start(spec)
    assert await supervisor.start(spec) is first


async def test_limit_is_enforced(supervisor: InstanceSupervisor) -> None:
    """⚠ 上限是 asyncio 单线程的保护，超了必须拒绝而不是硬撑。"""
    await supervisor.start(_spec(supervisor_port(supervisor, 0), "a"))
    await supervisor.start(_spec(supervisor_port(supervisor, 1), "b"))
    with pytest.raises(InstanceLimitReached):
        await supervisor.start(_spec(supervisor_port(supervisor, 2), "c"))


async def test_requesting_an_assigned_port_is_rejected_before_binding(
    supervisor: InstanceSupervisor,
) -> None:
    """同一个端口不会发给两台实例——记账阶段就挡住，不必等 bind 失败。"""
    taken = supervisor_port(supervisor, 0)
    await supervisor.start(_spec(taken, "a"))
    with pytest.raises(PortPoolExhausted):
        await supervisor.start(_spec(taken, "b"))


async def test_failed_start_returns_the_port_to_the_pool(
    supervisor: InstanceSupervisor,
) -> None:
    """⚠ 起失败不还端口的话，池会被永远起不来的实例慢慢吃光。

    这里模拟的是**池的配置与现实不符**：池里写着这个端口，但机器上另有程序
    占着它。记账挡不住这种情况，只能在 bind 时失败。
    """
    port = supervisor_port(supervisor, 0)
    spec = _spec(port, "a")
    with _occupied(port), pytest.raises(InstanceStartFailed):
        await supervisor.start(spec)
    assert supervisor.ports.assigned(spec.instance_id) is None


async def test_failed_start_is_not_tracked(
    supervisor: InstanceSupervisor,
) -> None:
    port = supervisor_port(supervisor, 0)
    spec = _spec(port, "a")
    with _occupied(port), pytest.raises(InstanceStartFailed):
        await supervisor.start(spec)
    assert supervisor.find(spec.instance_id) is None


async def test_stop_releases_the_port(
    supervisor: InstanceSupervisor,
) -> None:
    spec = _spec(supervisor_port(supervisor, 0))
    await supervisor.start(spec)
    await supervisor.stop(spec.instance_id)
    assert supervisor.ports.assigned(spec.instance_id) is None
    assert supervisor.count() == 0


async def test_stopping_an_unknown_instance_is_a_no_op(
    supervisor: InstanceSupervisor,
) -> None:
    await supervisor.stop(uuid4())
    assert supervisor.count() == 0


async def test_get_raises_for_unknown_instance(
    supervisor: InstanceSupervisor,
) -> None:
    with pytest.raises(InstanceNotFound):
        supervisor.get(uuid4())


async def test_find_returns_none_for_unknown_instance(
    supervisor: InstanceSupervisor,
) -> None:
    assert supervisor.find(uuid4()) is None


async def test_stop_all_clears_everything(
    supervisor: InstanceSupervisor,
) -> None:
    await supervisor.start(_spec(supervisor_port(supervisor, 0), "a"))
    await supervisor.start(_spec(supervisor_port(supervisor, 1), "b"))
    await supervisor.stop_all()
    assert supervisor.count() == 0
    assert supervisor.ports.taken() == frozenset()


async def test_one_instance_does_not_block_the_other(
    supervisor: InstanceSupervisor,
) -> None:
    """⚠ 守 CONTEXT §4：一台起不来只让它自己失败。"""
    good = _spec(supervisor_port(supervisor, 0), "a")
    await supervisor.start(good)
    doomed = _spec(supervisor_port(supervisor, 1), "b")
    with _occupied(doomed.port), pytest.raises(InstanceStartFailed):
        await supervisor.start(doomed)
    assert await supervisor.get(good.instance_id).is_listening()
