"""无达标范围的冷启动在列表、筛选、覆盖和训练中保持同一口径。"""

from dataclasses import replace
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions
from unit.source_fakes import FakeAcSource

from integration.test_ac_startup_api import PREFIX, at, make_batch
from integration.test_ac_startup_window_api import bound_room
from platform_server.apps.hvac.crud import ac_startup_episode_crud
from platform_server.apps.hvac.models import AcStartupBatch, AcStartupEpisode
from platform_server.apps.hvac.rooms import MetricBand, RoomUnit
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.seasons import WinterPeriod
from platform_server.apps.hvac.services.ac_model_trainer import _load_inputs
from platform_server.apps.hvac.services.ac_room_configuration import (
    BoundUnit,
    restore_configuration,
)
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_extract import (
    ExtractionContext,
    run_shard,
)
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_service import (
    finalize_if_complete,
    request_rebuild,
)

pytestmark = pytest.mark.requires_postgres


def _zero_episode(
    batch: AcStartupBatch, started: datetime, serial: str
) -> AcStartupEpisode:
    return AcStartupEpisode(
        batch_id=batch.id,
        room_id=batch.room_id,
        started_at=started,
        running_set=[serial],
        complied_at=started,
        duration_minutes=0,
        outcome="usable",
        readings={},
        idle_minutes=30,
    )


async def _legacy_zero(
    db_session: AsyncSession, *, is_frozen: bool
) -> AcStartupEpisode:
    room = await bound_room(db_session, "旧启动评估")
    batch = await make_batch(db_session, room)
    batch.logic_version = 3
    if not is_frozen:
        batch.configuration_snapshot = None
    row = _zero_episode(batch, at(30), "K11-旧启动评估")
    db_session.add(row)
    await db_session.commit()
    return row


async def test_legacy_zero_without_ranges_is_projected_without_mutation(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    row = await _legacy_zero(db_session, is_frozen=True)
    prefix = f"{PREFIX}/rooms/{row.room_id}"
    episodes = prefix + "/startup-episodes"
    response = await app_client.get(episodes)
    assert response.status_code == 200, response.text
    [found] = response.json()["data"]["items"]
    assert found["outcome"] == "unassessed"
    assert found["complied_at"] is None
    assert found["duration_minutes"] is None

    filtered = await app_client.get(episodes, params={"outcome": "unassessed"})
    assert filtered.status_code == 200
    assert filtered.json()["data"]["items"] == [found]
    usable = await app_client.get(episodes, params={"outcome": "usable"})
    assert usable.json()["data"]["items"] == []
    batches = await app_client.get(prefix + "/startup-batches")
    assert batches.json()["data"]["coverage"] == []
    training = await _load_inputs(
        db_session, row.room_id, timezone="Asia/Shanghai"
    )
    assert training.samples == []

    await db_session.refresh(row)
    assert row.outcome == "usable"
    assert row.duration_minutes == 0


async def test_legacy_zero_without_a_reliable_snapshot_is_left_as_it_was(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    row = await _legacy_zero(db_session, is_frozen=False)
    prefix = f"{PREFIX}/rooms/{row.room_id}"
    response = await app_client.get(prefix + "/startup-episodes")
    assert response.status_code == 200
    [found] = response.json()["data"]["items"]
    assert found["outcome"] == "usable"
    assert found["duration_minutes"] == 0
    batches = await app_client.get(prefix + "/startup-batches")
    [summary] = batches.json()["data"]["coverage"]
    assert summary["usable_count"] == 1


@pytest.mark.parametrize("logic_version", [2, 3])
async def test_legacy_projection_uses_the_frozen_local_season(
    app_client: httpx.AsyncClient, db_session: AsyncSession, logic_version: int
) -> None:
    room = await bound_room(db_session, "本地季节")
    batch = await make_batch(db_session, room)
    assert batch.configuration_snapshot is not None
    frozen = restore_configuration(batch.configuration_snapshot)
    [bound] = frozen.units
    room_unit = RoomUnit(
        serial=bound.unit.serial,
        bands={"workshop_temp_avg": MetricBand(Decimal(24), Decimal(26))},
        winter_period=WinterPeriod("11-01", "03-15"),
    )
    original = replace(
        frozen, units=(BoundUnit(room_unit, bound.source_object),)
    )
    batch.configuration_snapshot = original.snapshot()
    batch.params_fingerprint = original.fingerprint()
    batch.logic_version = logic_version
    for time in ("2026-03-15T15:30+00:00", "2026-03-15T16:30+00:00"):
        started = datetime.fromisoformat(time)
        db_session.add(_zero_episode(batch, started, room_unit.serial))
    await db_session.commit()

    prefix = f"{PREFIX}/rooms/{room}"
    response = await app_client.get(prefix + "/startup-episodes")
    assert response.status_code == 200, response.text
    later, earlier = response.json()["data"]["items"]
    assert later["outcome"] == "usable"
    assert later["duration_minutes"] == 0
    assert later["compliance"]
    expected_outcome = "unassessed" if logic_version == 3 else "usable"
    expected_duration = None if logic_version == 3 else 0
    assert earlier["outcome"] == expected_outcome
    assert earlier["duration_minutes"] == expected_duration
    filtered = await app_client.get(
        prefix + "/startup-episodes", params={"outcome": "unassessed"}
    )
    assert filtered.json()["data"]["items"] == (
        [earlier] if logic_version == 3 else []
    )
    batches = await app_client.get(prefix + "/startup-batches")
    [coverage] = batches.json()["data"]["coverage"]
    assert coverage["usable_count"] == (1 if logic_version == 3 else 2)


async def test_default_rebuild_persists_an_unassessed_cold_start(
    db_session: AsyncSession, worker_sessions: MakerSessions
) -> None:
    room = await bound_room(db_session, "默认未评估")
    zone = ZoneInfo("Asia/Shanghai")
    ems = FakeAcSource(
        samples=[
            {
                "CT": at(minute).astimezone(zone).replace(tzinfo=None),
                "fan_frequency": 0 if minute < 30 else 22,
                "workshop_temp_avg": 29,
                "workshop_humidity_avg": 52,
            }
            for minute in range(34)
        ]
    )
    reader = AcSourceReader(source=ems, timezone=zone.key)
    rules = ExtractionRules()
    plan = await request_rebuild(
        db_session,
        room_id=room,
        window=TimeWindow(start=at(0), end=at(34)),
        rules=rules,
        timezone=reader.timezone,
    )
    batch_id = plan.batch.id
    for message in plan.messages:
        await run_shard(
            worker_sessions, ExtractionContext(reader, rules, 200), message
        )
    completed = await finalize_if_complete(db_session, batch_id)
    assert completed is not None
    assert completed.is_current
    [row] = await ac_startup_episode_crud.list_by_batch(db_session, batch_id)
    assert row.outcome == "unassessed"
    assert row.complied_at is None
    assert row.duration_minutes is None
    assert await ac_startup_episode_crud.coverage(db_session, batch_id) == []
    trained = await _load_inputs(db_session, room, timezone=reader.timezone)
    assert not trained.samples
