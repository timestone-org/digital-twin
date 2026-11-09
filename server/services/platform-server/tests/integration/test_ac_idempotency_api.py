"""建模、重训与重算这几个长任务入口支持 `Idempotency-Key`（api-contract §7）。

⚠ 守的是「超时后的一次重试」：首次其实成功了，同键重试必须拿回首次结果，
而不是撞上「同名」「已在排队」「已有批次在跑」的 409。
"""

import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.ac_model_helpers import (
    PREFIX,
    SignHeaders,
    _mark_trained,
    create_body,
    create_model,
    seed_room,
)
from integration.test_ac_startup_window_api import bound_room
from platform_server.apps.hvac.catalog import AC_MANAGE

pytestmark = pytest.mark.requires_postgres

ACCEPTED = 202


async def test_a_retried_create_returns_the_first_model(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    seeded = await seed_room(db_session)
    headers = {**sign([AC_MANAGE]), "Idempotency-Key": "create-model-1"}
    body = create_body(seeded)
    first = await app_client.post(
        f"{PREFIX}/ac-models", json=body, headers=headers
    )
    second = await app_client.post(
        f"{PREFIX}/ac-models", json=body, headers=headers
    )
    assert first.status_code == ACCEPTED, first.text
    assert second.status_code == ACCEPTED, second.text
    assert second.json()["data"]["id"] == first.json()["data"]["id"]


async def test_a_retried_retrain_is_not_a_conflict(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    seeded = await seed_room(db_session)
    data = await create_model(app_client, sign([AC_MANAGE]), seeded)
    model_id = uuid.UUID(data["id"])
    await _mark_trained(db_session, model_id, running_set=[seeded.serials[0]])
    headers = {**sign([AC_MANAGE]), "Idempotency-Key": "retrain-1"}
    path = f"{PREFIX}/ac-models/{model_id}:retrain"
    first = await app_client.post(path, headers=headers)
    second = await app_client.post(path, headers=headers)
    assert first.status_code == ACCEPTED, first.text
    assert second.status_code == ACCEPTED, second.text
    assert second.json()["data"] == first.json()["data"]


async def test_a_retried_rebuild_returns_the_first_batch(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    room_id = await bound_room(db_session, "幂等重算")
    path = f"{PREFIX}/rooms/{room_id}/startup-batches:rebuild"
    body = {
        "window_start": "2026-01-01T00:00:00Z",
        "window_end": "2026-02-01T00:00:00Z",
    }
    headers = {"Idempotency-Key": "rebuild-1"}
    first = await app_client.post(path, json=body, headers=headers)
    second = await app_client.post(path, json=body, headers=headers)
    assert first.status_code == ACCEPTED, first.text
    assert second.status_code == ACCEPTED, second.text
    assert second.json()["data"]["batch_id"] == first.json()["data"]["batch_id"]


async def test_a_key_reused_on_another_model_is_not_replayed(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """⚠ 幂等键按路径上的模型分开：同一个键换一个模型，回放的是别人的结果。"""
    seeded = await seed_room(db_session)
    manage = sign([AC_MANAGE])
    first_id = (await create_model(app_client, manage, seeded))["id"]
    second_id = (await create_model(app_client, manage, seeded, name="晚班"))[
        "id"
    ]
    for model_id in (first_id, second_id):
        await _mark_trained(
            db_session, uuid.UUID(model_id), running_set=[seeded.serials[0]]
        )
    headers = {**manage, "Idempotency-Key": "retrain-shared"}
    first = await app_client.post(
        f"{PREFIX}/ac-models/{first_id}:retrain", headers=headers
    )
    second = await app_client.post(
        f"{PREFIX}/ac-models/{second_id}:retrain", headers=headers
    )
    assert first.status_code == ACCEPTED, first.text
    assert second.status_code == ACCEPTED, second.text
    assert second.json()["data"]["id"] == second_id
