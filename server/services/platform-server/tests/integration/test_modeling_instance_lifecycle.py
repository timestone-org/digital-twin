"""模型实例从训练到发布、部署、签名与真实预测的组合验证。"""

import uuid

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.modeling_helpers import data_of, drive_run
from integration.test_modeling_api import _seed_ledger
from integration.test_modeling_templates import INSTANCES, make_instance

VERSIONS = "/api/v1/platform/modeling-model-versions"
DEPLOYMENTS = "/api/v1/platform/modeling-deployments"


async def test_template_instance_trains_and_deploys(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    await _seed_ledger(app_client, db_session, "energy-data")
    instance = await make_instance(app_client)
    started = await app_client.post(
        f"{INSTANCES}/{instance['id']}:train", json={"trigger": "api"}
    )
    assert started.status_code == 202
    run_id = data_of(started)["id"]
    await drive_run(worker_sessions, uuid.UUID(run_id))
    instance = data_of(await app_client.get(f"{INSTANCES}/{instance['id']}"))
    assert instance["latest_run"]["status"] == "succeeded"
    published = await app_client.post(
        VERSIONS, json={"run_id": run_id, "name": "一号机模型"}
    )
    assert published.status_code == 201
    version = data_of(published)
    assert version["is_servable"] is True
    payload = {
        "model_version_id": version["id"],
        "code": "energy-instance",
        "name": "能耗服务",
    }
    headers = {"Idempotency-Key": "deploy-once"}
    deployed = await app_client.post(
        f"{INSTANCES}/{instance['id']}:deploy", json=payload, headers=headers
    )
    assert deployed.status_code == 201
    replay = await app_client.post(
        f"{INSTANCES}/{instance['id']}:deploy", json=payload, headers=headers
    )
    assert data_of(replay)["id"] == data_of(deployed)["id"]
    prediction = await app_client.post(
        "/api/v1/platform/open-models/energy-instance:predict",
        json={"rows": [{"温度": 25, "负荷": 430}]},
    )
    assert prediction.status_code == 200
    assert abs(data_of(prediction)["predictions"][0] - 1345) < 0.001
