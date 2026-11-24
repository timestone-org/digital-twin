"""空压站求解、模型作用域与 OPC UA 布尔值约定。"""

from collections.abc import Sequence
from uuid import UUID

import pytest
from pydantic import ValidationError

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


def _estimated_config() -> CompressedAirConfig:
    return CompressedAirConfig.model_validate(
        _config().model_dump()
        | {
            "demand_node_key": None,
            "estimated_flow_points": [
                {"power": f"{SOURCE}:p{i}", "site_qdb": f"{SOURCE}:eta{i}"}
                for i in range(1, 5)
            ],
            "calibration_table_id": UUID(int=82),
            "machines": (None, None, None, None),
            "recommendation_status_node_id": UUID(int=5),
        }
    )


def _estimated_readings() -> dict[str, PointReading]:
    values = {
        "p1": 120,
        "eta1": 10,
        "p2": 90,
        "eta2": 10,
        "p3": 120,
        "eta3": 7.5,
        "p4": 0,
        "eta4": 4,
    }
    return {
        f"{SOURCE}:{key}": PointReading(value, 1, "good")
        for key, value in values.items()
    }


def test_recommendation_uses_total_estimated_flow_of_all_four_machines() -> (
    None
):
    config = _estimated_config()
    readings = _estimated_readings()
    assert set(config.input_keys) == set(readings)
    assert recommended_machines(config, readings, _curves()) == (1, 2)
    assert recommended_machines(config, readings, {1: _curves()[1]}) == ()


@pytest.mark.parametrize(
    "reading",
    [
        None,
        PointReading(4, 1, "bad"),
        PointReading(4, 1, "uncertain"),
        PointReading(4, 1, "good", is_current=False),
        PointReading(float("nan"), 1, "good"),
        PointReading(float("inf"), 1, "good"),
        PointReading(True, 1, "good"),
        PointReading("4", 1, "good"),
        PointReading(-1, 1, "good"),
    ],
)
def test_bad_input_of_off_machine_prevents_partial_total(
    reading: PointReading | None,
) -> None:
    config = _estimated_config()
    readings = _estimated_readings()
    if reading is None:
        readings.pop(f"{SOURCE}:eta4")
    else:
        readings[f"{SOURCE}:eta4"] = reading
    assert recommended_machines(config, readings, _curves()) == ()


@pytest.mark.parametrize(
    ("replacement", "message"),
    [
        ({"demand_node_key": DEMAND}, "需气量输入"),
        ({"estimated_flow_points": None}, "需气量输入"),
        ({"available_node_keys": (f"{SOURCE}:p1", None, None, None)}, "重复"),
        ({"recommendation_status_node_id": UUID(int=2)}, "输出节点"),
        (
            {"machines": (_machine(1, is_fixed=True), None, None, None)},
            "标定来源",
        ),
    ],
)
def test_estimated_configuration_rejects_ambiguous_bindings(
    replacement: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValidationError, match=message):
        CompressedAirConfig.model_validate(
            _estimated_config().model_dump() | replacement
        )


async def test_publication_writes_total_flow_and_clears_invalid_outputs() -> (
    None
):
    config = _estimated_config()
    nodes = FakeNodeWriter()
    for node_id in config.recommendation_node_ids:
        nodes.add(config.opcua_instance_id, node_id, data_type="boolean")
    status_id = config.recommendation_status_node_id
    assert status_id is not None
    nodes.add(config.opcua_instance_id, status_id, data_type="string")
    readings = FakeSnapshotSource(readings=_estimated_readings())
    publisher = CompressedAirPublisher(
        config,
        PublicationSources(readings, _Online(), _calibration),
        nodes,
        FakeLease(),
    )
    await publisher.tick()
    for i in range(1, 5):
        readings.readings[f"{SOURCE}:p{i}"] = PointReading(0, 1, "good")
    await publisher.tick()
    readings.readings.pop(f"{SOURCE}:p4")
    await publisher.tick()
    values = [[item.value for item in batch] for _, batch in nodes.writes]
    assert values == [
        [True, True, False, False, "50.0 m³/min"],
        [False, False, False, False, "0.0 m³/min · 当前无产气"],
        [False, False, False, False, "等待四台机组有效采集"],
    ]
    assert all(nodes.keys)
