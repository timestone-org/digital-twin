"""两季真实抽取与训练用例的受控分钟数据。"""

import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from integration.test_ac_model_training_flow import OneSessionDatabase
from integration.test_ac_startup_batches_api import PREFIX, bound_room
from integration.test_ac_startup_daily import StubReader
from lib.db import Database
from platform_server.apps.hvac.models import AcUnit
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services.ac_model_trainer import run_training
from platform_server.apps.hvac.services.ac_source_reader import SourceRow
from platform_server.apps.hvac.services.ac_startup_extract import (
    ExtractionContext,
    run_shard,
)
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_service import (
    finalize_if_complete,
    request_rebuild,
)


def policy_body() -> dict[str, object]:
    return {
        "winter_period": {"start": "11-15", "end": "03-15"},
        "non_winter": [
            {
                "metric": "workshop_temp_avg",
                "lower_limit": "24",
                "upper_limit": "28",
            },
            {
                "metric": "workshop_humidity_avg",
                "lower_limit": "55",
                "upper_limit": "65",
            },
        ],
        "winter": [
            {
                "metric": "workshop_temp_avg",
                "lower_limit": "20",
                "upper_limit": "24",
            },
            {
                "metric": "workshop_humidity_avg",
                "lower_limit": "45",
                "upper_limit": "55",
            },
        ],
    }


def historical_rows() -> list[SourceRow]:
    return [
        SourceRow(
            ts=datetime(2026, month, day, 1, tzinfo=UTC)
            + timedelta(minutes=offset),
            values={
                "fan_frequency": 0.0 if offset < 0 else 40.0,
                "workshop_temp_avg": 22.0 if offset < 10 else 26.0,
                "workshop_humidity_avg": 50.0 if offset < 10 else 60.0,
            },
        )
        for month in (1, 7)
        for day in range(1, 21)
        for offset in range(-35, 16)
    ]


@dataclass(frozen=True)
class SeasonalModel:
    room_id: uuid.UUID
    unit_id: uuid.UUID
    serial: str
    model_id: uuid.UUID


async def extract_seasons(session: AsyncSession, room_id: uuid.UUID) -> None:
    rules = ExtractionRules()
    plan = await request_rebuild(
        session,
        room_id=room_id,
        window=TimeWindow(
            datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 8, 1, tzinfo=UTC)
        ),
        rules=rules,
    )
    context = ExtractionContext(StubReader(historical_rows()), rules, 100000)
    for message in plan.messages:
        await run_shard(session, context, message)
    batch = await finalize_if_complete(session, plan.batch.id)
    assert batch is not None
    assert batch.is_current
    assert batch.episode_count == 40


async def train_seasons(
    client: httpx.AsyncClient, session: AsyncSession
) -> SeasonalModel:
    room_id = await bound_room(session, "两季整链")
    unit = await session.scalar(select(AcUnit).where(AcUnit.room_id == room_id))
    assert unit is not None
    saved = await client.put(
        f"{PREFIX}/ac-units/{unit.id}/compliance-policies", json=policy_body()
    )
    assert saved.status_code == 200, saved.text
    await extract_seasons(session, room_id)
    made = await client.post(
        f"{PREFIX}/ac-models",
        json={
            "room_id": str(room_id),
            "name": "两季模型",
            "serving_sets": [[unit.serial]],
        },
    )
    assert made.status_code == 202, made.text
    model_id = uuid.UUID(made.json()["data"]["id"])
    with ThreadPoolExecutor(max_workers=1) as executor:
        trained = await run_training(
            cast(Database, OneSessionDatabase(session)),
            executor=executor,
            timezone="Asia/Shanghai",
            model_id=model_id,
        )
    assert trained.outcome == "trained", trained.reason
    return SeasonalModel(room_id, unit.id, unit.serial, model_id)
