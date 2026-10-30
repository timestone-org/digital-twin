"""模型实例从训练到发布、部署、签名与真实预测的组合验证。"""

import uuid

import httpx
from conftest import SignHeaders
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
    sign: SignHeaders,
) -> None:
    await _seed_ledger(app_client, db_session, "energy-data")
    instance = await make_instance(app_client)
    caller = sign(("modeling:view", "modeling:run", "modeling:publish"))
    await configure(app_client, instance["id"], caller)
    started = await app_client.post(
        f"{INSTANCES}/{instance['id']}:train",
        json={"trigger": "api"},
        headers=caller,
    )
    assert started.status_code == 202
    run_id = data_of(started)["id"]
    await drive_run(worker_sessions, uuid.UUID(run_id))
    instance = data_of(
        await app_client.get(f"{INSTANCES}/{instance['id']}", headers=caller)
    )
    assert instance["latest_run"]["status"] == "succeeded"
    version_id = await publish_once(app_client, run_id, caller)
    payload = {
        "model_version_id": version_id,
        "code": "energy-instance",
        "name": "能耗服务",
    }
    headers = {**caller, "Idempotency-Key": "deploy-once"}
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
        headers=caller,
    )
    assert prediction.status_code == 200
    assert abs(data_of(prediction)["predictions"][0] - 1345) < 0.001


async def configure(
    client: httpx.AsyncClient, instance_id: str, caller: dict[str, str]
) -> None:
    """通过第三方权限保存完整参数；Args: client, instance_id, caller。"""
    url = f"{INSTANCES}/{instance_id}/configuration"
    configuration = data_of(await client.get(url, headers=caller))[
        "configuration"
    ]
    configured = await client.put(
        url,
        json={"expected_revision": 1, "configuration": configuration},
        headers=caller,
    )
    assert configured.status_code == 200
    assert data_of(configured)["revision"] == 2


async def publish_once(
    client: httpx.AsyncClient, run_id: str, caller: dict[str, str]
) -> str:
    """校验版本发布幂等返回同一资源；Args: client, run_id, caller。"""
    publication = {"run_id": run_id, "name": "一号机模型"}
    headers = {**caller, "Idempotency-Key": "publish-once"}
    published = await client.post(VERSIONS, json=publication, headers=headers)
    assert published.status_code == 201
    version = data_of(published)
    assert version["is_servable"] is True
    replayed = await client.post(VERSIONS, json=publication, headers=headers)
    assert replayed.status_code == 201
    assert data_of(replayed)["id"] == version["id"]
    assert published.headers["location"] == f"{VERSIONS}/{version['id']}"
    assert replayed.headers["location"] == published.headers["location"]
    return version["id"]
