"""空压站求解、模型作用域与 OPC UA 布尔值约定。"""

from collections.abc import Sequence
from uuid import UUID

from platform_server.apps.collect.services.snapshot_source import PointReading
from platform_server.apps.compressed_air.config import (
    CompressedAirConfig,
    MachinePoints,
)
from platform_server.apps.compressed_air.models import Curves, Knot
from platform_server.apps.compressed_air.services.dispatch import recommend
from platform_server.apps.compressed_air.services.publication import (
    CompressedAirPublisher,
    PublicationSources,
    recommended_machines,
)
from unit.opcua_fakes import FakeNodeWriter
from unit.publish_fakes import FakeLease, FakeSnapshotSource

SOURCE = UUID(int=80)
DEMAND = f"{SOURCE}:demand"


def _config() -> CompressedAirConfig:
    return CompressedAirConfig(
        demand_node_key=DEMAND,
        opcua_instance_id=UUID(int=81),
        recommendation_node_ids=(
            UUID(int=1),
            UUID(int=2),
            UUID(int=3),
            UUID(int=4),
        ),
        machines=(
            _machine(1, is_fixed=True),
            _machine(2),
            _machine(3),
            _machine(4),
        ),
    )


def _machine(index: int, *, is_fixed: bool = False) -> MachinePoints:
    return MachinePoints(
        volume=f"{SOURCE}:q{index}",
        power=f"{SOURCE}:p{index}",
        pressure=f"{SOURCE}:b{index}",
        speed=None if is_fixed else f"{SOURCE}:n{index}",
    )


def _curves() -> Curves:
    return {
        1: (Knot(30, 230),),
        2: (Knot(10, 70), Knot(25, 150)),
        3: (Knot(5, 55), Knot(12, 135)),
        4: (Knot(4, 40), Knot(10, 80)),
    }


def test_dispatch_minimizes_power_at_exact_demand() -> None:
    result = recommend(50, (1, 2, 3, 4), _curves())
    assert result is not None
    assert result.machines == (1, 2)
    assert result.power_kw == 230 + 70 + (10 / 15) * 80


def test_dispatch_leaves_unattainable_load_outside_the_model() -> None:
    assert recommend(2, (1, 2, 3, 4), _curves()) is None
    assert recommend(70, (2, 3, 4), _curves()) is None


def test_recommendation_requires_a_current_input_and_all_available_curves() -> (
    None
):
    configuration = _config()
    good = {DEMAND: PointReading(50, 1, "good")}
    assert recommended_machines(configuration, good, _curves()) == (1, 2)
    assert recommended_machines(configuration, good, {1: _curves()[1]}) == ()
    stale = {DEMAND: PointReading(50, 1, "good", is_current=False)}
    assert recommended_machines(configuration, stale, _curves()) == ()


class _Online:
    async def online_ids(self, source_ids: Sequence[UUID]) -> frozenset[UUID]:
        return frozenset(source_ids)


async def _calibration() -> Curves:
    return _curves()


async def test_publication_writes_four_booleans_in_order() -> None:
    config = _config()
    nodes = FakeNodeWriter()
    for node_id in config.recommendation_node_ids:
        nodes.add(config.opcua_instance_id, node_id, data_type="boolean")
    readings = FakeSnapshotSource(
        readings={DEMAND: PointReading(50, 1, "good")}
    )
    publisher = CompressedAirPublisher(
        config,
        PublicationSources(readings, _Online(), _calibration),
        nodes,
        FakeLease(),
    )
    await publisher.tick()
    readings.readings.clear()
    await publisher.tick()
    assert [[item.value for item in items] for _, items in nodes.writes] == [
        [True, True, False, False],
        [False, False, False, False],
    ]
    assert all(nodes.keys)
