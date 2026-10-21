"""逐台季节配置的保存、校验与抽取批次失效契约。"""

import httpx
import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession

from integration.test_ac_startup_batches_api import BASE, PREFIX, bound_room
from platform_server.apps.hvac.models import AcUnit
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_service import (
    request_rebuild,
)


async def test_changing_limits_invalidates_an_extracted_batch(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    room_id = await bound_room(db_session, "季节指纹")
    unit = await db_session.scalar(
        select(AcUnit).where(AcUnit.room_id == room_id)
    )
    assert unit is not None
    plan = await request_rebuild(
        db_session,
        room_id=room_id,
        window=TimeWindow(start=BASE, end=BASE.replace(month=4)),
        rules=ExtractionRules(),
    )
    plan.batch.status = "ready"
    plan.batch.shard_done = plan.batch.shard_total
    plan.batch.is_current = True
    await db_session.flush()
    changed = await app_client.put(
        f"{PREFIX}/ac-units/{unit.id}/metric-limits",
        json={
            "items": [
                {
                    "metric": "workshop_temp_avg",
                    "lower_limit": "20",
                    "upper_limit": "24",
                }
            ]
        },
    )
    assert changed.status_code == 200
    response = await app_client.get(f"{PREFIX}/rooms/{room_id}/startup-batches")
    assert response.json()["data"]["is_stale"] is True


async def test_seasonal_policy_roundtrips_both_complete_ranges(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    room_id = await bound_room(db_session, "季节保存")
    unit = await db_session.scalar(
        select(AcUnit).where(AcUnit.room_id == room_id)
    )
    assert unit is not None
    body = {
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
    url = f"{PREFIX}/ac-units/{unit.id}/compliance-policies"
    response = await app_client.put(url, json=body)
    assert response.status_code == 200, response.text
    saved = (await app_client.get(url)).json()["data"]
    assert saved["winter_period"] == body["winter_period"]
    assert {
        item["metric"]: item["lower_limit"] for item in saved["winter"]
    } == {
        "workshop_temp_avg": "20.00",
        "workshop_humidity_avg": "45.00",
    }


@pytest.mark.parametrize(
    "patch",
    [
        {"winter_period": {"start": "11-15"}},
        {"winter_period": {"start": "02-30", "end": "03-15"}},
        {"winter": []},
        {"non_winter": []},
        {"winter": [{"metric": "workshop_temp_avg", "lower_limit": "20"}]},
    ],
)
async def test_incomplete_seasonal_policy_is_rejected_without_partial_save(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    patch: dict[str, object],
) -> None:
    room_id = await bound_room(db_session, "季节校验")
    unit = await db_session.scalar(
        select(AcUnit).where(AcUnit.room_id == room_id)
    )
    assert unit is not None
    limits = [
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
    ]
    body = {
        "winter_period": {"start": "11-15", "end": "03-15"},
        "non_winter": limits,
        "winter": limits,
    }
    url = f"{PREFIX}/ac-units/{unit.id}/compliance-policies"
    assert (await app_client.put(url, json=body)).status_code == 200
    before = (await app_client.get(url)).json()["data"]
    rejected = await app_client.put(url, json={**body, **patch})
    assert rejected.status_code == 400
    after = (await app_client.get(url)).json()["data"]
    for field in ("winter_period", "non_winter", "winter"):
        assert after[field] == before[field]
    legacy = await app_client.put(
        f"{PREFIX}/ac-units/{unit.id}/metric-limits", json={"items": []}
    )
    assert legacy.status_code == 400


async def test_policy_get_reads_both_seasons_in_one_database_snapshot(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    room_id = await bound_room(db_session, "配置原子读取")
    unit = await db_session.scalar(
        select(AcUnit).where(AcUnit.room_id == room_id)
    )
    assert unit is not None
    statements: list[str] = []
    connection = db_session.sync_session.get_bind()

    def record(
        _connection: object, _cursor: object, sql: str, *_context: object
    ) -> None:
        if "platform.hvac_ac_" in sql:
            statements.append(sql)

    event.listen(connection, "before_cursor_execute", record)
    try:
        response = await app_client.get(
            f"{PREFIX}/ac-units/{unit.id}/compliance-policies"
        )
    finally:
        event.remove(connection, "before_cursor_execute", record)
    assert response.status_code == 200
    assert len(statements) == 1
