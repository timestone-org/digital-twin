"""试算端点与「训过的模型」相关口径，打真实 Postgres。

⚠ 试算是纯计算：读工件、按工件自己的机组清单拼特征行——房间机组后来怎么
变动都不该让老工件炸。造房间与建模的公共件复用模型面用例那份。
"""

import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.test_ac_model_api import (
    PREFIX,
    SignHeaders,
    _mark_trained,
    create_model,
    seed_room,
)
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.models import AcModelArtifact

pytestmark = pytest.mark.requires_postgres


async def test_predict_returns_quantiles_and_marks_extrapolation(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """试算：三分位有序非负；服务组合之外标外推不拒绝。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(
        app_client, manager, seeded, serving_sets=[[seeded.serials[0]]]
    )
    model_id = uuid.UUID(data["id"])
    await _mark_trained(db_session, model_id, running_set=[seeded.serials[0]])
    viewer = sign([AC_VIEW])
    body = {
        "running_set": [seeded.serials[0]],
        "readings": {seeded.serials[0]: {"workshop_temp_avg": 30.0}},
        "idle_minutes": 390,
    }
    served = await app_client.post(
        f"{PREFIX}/ac-models/{model_id}:predict", json=body, headers=viewer
    )
    assert served.status_code == 200, served.text
    found = served.json()["data"]
    assert 0 <= found["p10"] <= found["p50"] <= found["p90"]
    assert found["is_in_serving_sets"] is True
    # 30 条全是这一个组合的样本 → 它有专属子模型
    assert found["is_dedicated"] is True
    assert found["reliability"] in {"reliable", "indicative", "weak"}
    outside = await app_client.post(
        f"{PREFIX}/ac-models/{model_id}:predict",
        json={**body, "running_set": list(seeded.serials)},
        headers=viewer,
    )
    assert outside.json()["data"]["is_in_serving_sets"] is False
    # 这个组合没攒到样本 → 共用模型兜底
    assert outside.json()["data"]["is_dedicated"] is False


async def test_predict_before_training_is_a_conflict(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """没训过就试算：409 且说清先训练。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    response = await app_client.post(
        f"{PREFIX}/ac-models/{data['id']}:predict",
        json={"running_set": [seeded.serials[0]]},
        headers=sign([AC_VIEW]),
    )
    assert response.status_code == 409
    assert response.json()["code"] == 41622


async def test_predict_rejects_an_unknown_serial(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """组合里有模型不认识的机组：422 且点名。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    model_id = uuid.UUID(data["id"])
    await _mark_trained(db_session, model_id, running_set=[seeded.serials[0]])
    response = await app_client.post(
        f"{PREFIX}/ac-models/{model_id}:predict",
        json={"running_set": ["K99"]},
        headers=sign([AC_VIEW]),
    )
    assert response.status_code == 422
    assert "K99" in response.json()["message"]


async def test_a_corrupted_artifact_is_a_conflict_with_a_reason(
    app_client: httpx.AsyncClient, db_session: AsyncSession, sign: SignHeaders
) -> None:
    """⚠ 工件没过护栏：409 + 人话原因，不静默降级也不 500。"""
    seeded = await seed_room(db_session)
    manager = sign([AC_MANAGE])
    data = await create_model(app_client, manager, seeded)
    model_id = uuid.UUID(data["id"])
    await _mark_trained(db_session, model_id, running_set=[seeded.serials[0]])
    artifact = await db_session.get(AcModelArtifact, model_id)
    assert artifact is not None
    artifact.digest = "f" * 64
    await db_session.flush()
    response = await app_client.post(
        f"{PREFIX}/ac-models/{model_id}:predict",
        json={"running_set": [seeded.serials[0]]},
        headers=sign([AC_VIEW]),
    )
    assert response.status_code == 409
    assert response.json()["code"] == 41624
    assert "摘要不符" in response.json()["message"]
