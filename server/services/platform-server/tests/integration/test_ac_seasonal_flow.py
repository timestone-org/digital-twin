"""季节配置经真实抽取、训练、预测到自动下发的整链契约。"""

import asyncio
import threading
import uuid
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import cast

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from unit.opcua_fakes import FakeNodeWriter
from unit.source_fakes import FakeAcSource

from integration.ac_seasonal_helpers import (
    SeasonalModel,
    historical_rows,
    policy_body,
    train_seasons,
)
from integration.test_ac_model_training_flow import OneSessionDatabase
from integration.test_ac_startup_batches_api import PREFIX, bound_room
from integration.test_ac_startup_daily import StubReader
from lib.db import Database
from platform_server.apps.hvac.modeling.features import EpisodeSample
from platform_server.apps.hvac.modeling.training import TrainedModel
from platform_server.apps.hvac.models import AcModelArtifact, AcUnit
from platform_server.apps.hvac.rooms import RoomUnit
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services import (
    ac_live_readings,
    ac_model_trainer,
)
from platform_server.apps.hvac.services.ac_startup_extract import (
    ExtractionContext,
    run_shard,
)
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_service import (
    finalize_if_complete,
    request_rebuild,
)


@pytest.fixture
async def seasonal_model(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> SeasonalModel:
    return await train_seasons(app_client, db_session)


async def test_historical_labels_and_predictions_use_the_event_season(
    app_client: httpx.AsyncClient,
    seasonal_model: SeasonalModel,
) -> None:
    model = seasonal_model
    events = (
        await app_client.get(
            f"{PREFIX}/rooms/{model.room_id}/startup-episodes",
            params={"limit": 100},
        )
    ).json()["data"]["items"]
    winter = [
        event for event in events if event["started_at"].startswith("2026-01")
    ]
    summer = [
        event for event in events if event["started_at"].startswith("2026-07")
    ]
    assert len(winter) == len(summer) == 20
    assert {event["duration_minutes"] for event in winter} == {0}
    assert {event["duration_minutes"] for event in summer} == {10}
    assert {event["compliance"][0]["season"] for event in winter} == {"winter"}
    values = []
    for month, season in ((1, "winter"), (7, "non_winter")):
        predicted = await app_client.post(
            f"{PREFIX}/ac-models/{model.model_id}:predict",
            json={
                "at": f"2026-{month:02d}-05T01:05:00Z",
                "running_set": [model.serial],
                "readings": {
                    model.serial: {
                        "workshop_temp_avg": 22,
                        "workshop_humidity_avg": 50,
                    }
                },
            },
        )
        assert predicted.status_code == 200, predicted.text
        found = predicted.json()["data"]
        assert found["compliance"][0]["season"] == season
        values.append(found["p50"])
    assert values[0] < values[1]


async def _bind(
    client: httpx.AsyncClient, model: SeasonalModel, nodes: FakeNodeWriter
) -> None:
    instance, region, duration = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    nodes.add(instance, region, data_type="string")
    nodes.add(instance, duration, data_type="double")
    saved = await client.put(
        f"{PREFIX}/ac-models/{model.model_id}/publication",
        json={
            "opcua_instance_id": str(instance),
            "recommendation_node_id": str(region),
            "set_bindings": [
                {"set_key": model.serial, "node_id": str(duration)}
            ],
            "is_enabled": True,
        },
    )
    assert saved.status_code == 200, saved.text


async def test_publish_uses_season_and_rejects_changed_configuration(
    app_client: httpx.AsyncClient,
    seasonal_model: SeasonalModel,
    node_writer: FakeNodeWriter,
    ac_source: FakeAcSource,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = seasonal_model
    await _bind(app_client, model, node_writer)
    await _assert_seasonal_publishing(app_client, model, ac_source, monkeypatch)
    changed = await app_client.put(
        f"{PREFIX}/ac-units/{model.unit_id}/compliance-policies",
        json={
            **policy_body(),
            "winter_period": {"start": "10-01", "end": "03-15"},
        },
    )
    assert changed.status_code == 200
    stale = (
        await app_client.get(f"{PREFIX}/ac-models/{model.model_id}")
    ).json()["data"]
    assert stale["is_batch_stale"] is True
    result = (
        await app_client.post(
            f"{PREFIX}/ac-models/{model.model_id}/publication:publish"
        )
    ).json()["data"]
    assert result["status"] == "degraded"
    assert (
        next(
            item["value"]
            for item in result["items"]
            if item["set_key"] == model.serial
        )
        == -1
    )


async def _assert_seasonal_publishing(
    app_client: httpx.AsyncClient,
    model: SeasonalModel,
    ac_source: FakeAcSource,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    values = []
    for month in (1, 7):
        at = datetime(2026, month, 5, 1, 5, tzinfo=UTC)
        monkeypatch.setattr(
            ac_live_readings, "utcnow", lambda moment=at: moment
        )
        ac_source.samples = [
            {
                "CT": datetime.fromisoformat(f"2026-{month:02d}-05T09:05:00"),
                "fan_frequency": 40,
                "workshop_temp_avg": 22,
                "workshop_humidity_avg": 50,
            }
        ]
        result = await app_client.post(
            f"{PREFIX}/ac-models/{model.model_id}/publication:publish"
        )
        assert result.status_code == 200, result.text
        data = result.json()["data"]
        assert data["status"] == "ok"
        values.append(
            next(
                item["value"]
                for item in data["items"]
                if item["set_key"] == model.serial
            )
        )
    assert values[0] < values[1]


async def test_changed_policy_blocks_batch_promotion(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    from_context = await bound_room(db_session, "季节重算期间")
    unit = await db_session.scalar(
        select(AcUnit).where(AcUnit.room_id == from_context)
    )
    assert unit is not None
    url = f"{PREFIX}/ac-units/{unit.id}/compliance-policies"
    assert (await app_client.put(url, json=policy_body())).status_code == 200
    rules = ExtractionRules()
    plan = await request_rebuild(
        db_session,
        room_id=from_context,
        rules=rules,
        window=TimeWindow(
            datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 2, 1, tzinfo=UTC)
        ),
    )
    context = ExtractionContext(StubReader(historical_rows()), rules, 100000)
    await run_shard(db_session, context, plan.messages[0])
    changed = {
        **policy_body(),
        "winter_period": {"start": "02-01", "end": "03-15"},
    }
    assert (await app_client.put(url, json=changed)).status_code == 200
    finished = await finalize_if_complete(db_session, plan.batch.id)
    assert finished is not None
    assert finished.status == "failed"
    assert finished.is_current is False


def _pause_training(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[asyncio.Event, threading.Event]:
    ready, release = asyncio.Event(), threading.Event()
    loop = asyncio.get_running_loop()
    original = ac_model_trainer.train

    def fit(
        samples: Sequence[EpisodeSample],
        *,
        units: Sequence[RoomUnit],
        timezone: str,
        half_life_days: float,
        serving_sets: Sequence[Sequence[str]] = (),
    ) -> TrainedModel:
        loop.call_soon_threadsafe(ready.set)
        if not release.wait(timeout=30):
            raise RuntimeError("测试未释放训练")
        return original(
            samples,
            units=units,
            timezone=timezone,
            half_life_days=half_life_days,
            serving_sets=serving_sets,
        )

    monkeypatch.setattr(ac_model_trainer, "train", fit)
    return ready, release


async def test_training_preserves_previous_artifact_when_policy_changes(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    seasonal_model: SeasonalModel,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = seasonal_model
    artifact = await db_session.get(AcModelArtifact, model.model_id)
    assert artifact is not None
    digest = artifact.digest
    ready, release = _pause_training(monkeypatch)
    with ThreadPoolExecutor(max_workers=1) as executor:
        task = asyncio.create_task(
            ac_model_trainer.run_training(
                cast(Database, OneSessionDatabase(db_session)),
                executor=executor,
                timezone="Asia/Shanghai",
                model_id=model.model_id,
            )
        )
        try:
            await asyncio.wait_for(ready.wait(), timeout=10)
            changed = await app_client.put(
                f"{PREFIX}/ac-units/{model.unit_id}/compliance-policies",
                json={
                    **policy_body(),
                    "winter_period": {"start": "10-01", "end": "03-15"},
                },
            )
            assert changed.status_code == 200
        finally:
            release.set()
        result = await task
    assert result.outcome == "failed"
    assert result.reason is not None
    assert "训练期间" in result.reason
    retained = await db_session.get(AcModelArtifact, model.model_id)
    assert retained is not None
    assert retained.digest == digest
