"""端口池分配器：分配、归还、池满响亮失败。"""

from uuid import uuid4

import pytest

from opcua_server.apps.instance.errors import PortPoolExhausted
from opcua_server.apps.instance.runtime.ports import PortAllocator


def test_reserve_gives_the_lowest_free_port() -> None:
    allocator = PortAllocator((4840, 4841, 4842))
    assert allocator.reserve(uuid4()) == 4840


def test_reserve_is_idempotent_for_the_same_instance() -> None:
    allocator = PortAllocator((4840, 4841))
    instance_id = uuid4()
    first = allocator.reserve(instance_id)
    assert allocator.reserve(instance_id) == first


def test_two_instances_never_share_a_port() -> None:
    allocator = PortAllocator((4840, 4841))
    assert allocator.reserve(uuid4()) != allocator.reserve(uuid4())


def test_exhausted_pool_raises_rather_than_picking_outside() -> None:
    allocator = PortAllocator((4840,))
    allocator.reserve(uuid4())
    with pytest.raises(PortPoolExhausted):
        allocator.reserve(uuid4())


def test_released_port_returns_to_the_pool() -> None:
    allocator = PortAllocator((4840,))
    first = uuid4()
    allocator.reserve(first)
    allocator.release(first)
    assert allocator.reserve(uuid4()) == 4840


def test_releasing_an_unknown_instance_is_a_no_op() -> None:
    allocator = PortAllocator((4840,))
    allocator.release(uuid4())
    assert allocator.taken() == frozenset()


def test_preferred_port_is_honoured_so_restarts_keep_the_endpoint() -> None:
    allocator = PortAllocator((4840, 4841, 4842))
    assert allocator.reserve(uuid4(), 4842) == 4842


def test_preferred_port_outside_the_pool_is_rejected() -> None:
    allocator = PortAllocator((4840, 4841))
    with pytest.raises(PortPoolExhausted):
        allocator.reserve(uuid4(), 5000)


def test_preferred_port_held_by_another_instance_is_rejected() -> None:
    allocator = PortAllocator((4840, 4841))
    allocator.reserve(uuid4(), 4840)
    with pytest.raises(PortPoolExhausted):
        allocator.reserve(uuid4(), 4840)


def test_assigned_reports_none_before_reservation() -> None:
    allocator = PortAllocator((4840,))
    assert allocator.assigned(uuid4()) is None


def test_assigned_reports_the_reserved_port() -> None:
    allocator = PortAllocator((4840,))
    instance_id = uuid4()
    allocator.reserve(instance_id)
    assert allocator.assigned(instance_id) == 4840


def test_pool_is_sorted_and_deduplicated() -> None:
    allocator = PortAllocator((4842, 4840, 4840, 4841))
    assert allocator.pool == (4840, 4841, 4842)


def test_contains_reports_pool_membership() -> None:
    allocator = PortAllocator((4840, 4841))
    assert allocator.contains(4840)
    assert not allocator.contains(4900)


def test_taken_reports_the_ports_in_use() -> None:
    allocator = PortAllocator((4840, 4841))
    instance_id = uuid4()
    allocator.reserve(instance_id, 4841)
    assert allocator.taken() == frozenset({4841})
