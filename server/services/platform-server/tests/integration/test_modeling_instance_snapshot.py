"""历史训练配置可继续优化，读取不改变当前实例或冻结运行。"""

import copy
import uuid

import httpx
import pytest
from conftest import SignHeaders
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_helpers import data_of
from integration.test_modeling_templates import INSTANCES, make_instance
from platform_server.apps.modeling.models import ModelingRun


async def _capture_run(
    client: httpx.AsyncClient, session: AsyncSession, instance_id: str
) -> ModelingRun:
    response = await client.post(
        f"{INSTANCES}/{instance_id}:train", json={"trigger": "api"}
    )
    assert response.status_code == 202
    run = await session.get(ModelingRun, uuid.UUID(data_of(response)["id"]))
    assert run is not None
    run.status = "cancelled"
    await session.flush()
    return run


async def test_historical_configuration_can_be_applied_as_a_new_revision(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    instance = await make_instance(app_client)
    url = f"{INSTANCES}/{instance['id']}/configuration"
    original = data_of(await app_client.get(url))["configuration"]
    run = await _capture_run(app_client, db_session, instance["id"])
    changed = copy.deepcopy(original)
    changed["nodes"]["s"]["table_code"] = "optimized-data"
    response = await app_client.put(
        url, json={"expected_revision": 1, "configuration": changed}
    )
    assert response.status_code == 200

    historical = data_of(
        await app_client.get(url, params={"run_id": str(run.id)})
    )
    assert historical["configuration"] == original
    assert historical["instance"]["revision"] == 2
    assert data_of(await app_client.get(url))["configuration"] == changed

    applied = await app_client.put(
        url,
        json={
            "expected_revision": historical["instance"]["revision"],
            "configuration": historical["configuration"],
        },
    )
    assert applied.status_code == 200
    assert data_of(applied)["revision"] == 3
    assert data_of(await app_client.get(url))["configuration"] == original
    frozen = data_of(
        await app_client.get(f"/api/v1/platform/modeling-runs/{run.id}")
    )
    assert frozen["graph"]["nodes"][0]["config"]["table_code"] == "energy-data"


@pytest.mark.parametrize("kind", ["absent", "foreign"])
async def test_historical_configuration_requires_a_run_of_this_instance(
    app_client: httpx.AsyncClient, db_session: AsyncSession, kind: str
) -> None:
    instance = await make_instance(app_client)
    run_id = uuid.UUID("00000000-0000-4000-8000-000000000123")
    if kind == "foreign":
        other = data_of(
            await app_client.post(
                INSTANCES,
                json={
                    "template_id": instance["template_id"],
                    "code": "other-instance",
                    "name": "另一模型",
                },
            )
        )
        run_id = (await _capture_run(app_client, db_session, other["id"])).id
    response = await app_client.get(
        f"{INSTANCES}/{instance['id']}/configuration",
        params={"run_id": str(run_id)},
    )
    assert response.status_code == 404


@pytest.mark.parametrize("change", ["operator", "edge", "parameter"])
async def test_incompatible_historical_configuration_is_rejected(
    app_client: httpx.AsyncClient, db_session: AsyncSession, change: str
) -> None:
    instance = await make_instance(app_client)
    run = await _capture_run(app_client, db_session, instance["id"])
    graph = copy.deepcopy(run.graph_snapshot)
    if change == "operator":
        graph["nodes"][0]["operator"] = "bdm_source"
    elif change == "edge":
        graph["edges"] = []
    else:
        graph["nodes"][0]["config"]["removed_parameter"] = True
    run.graph_snapshot = graph
    await db_session.flush()
    response = await app_client.get(
        f"{INSTANCES}/{instance['id']}/configuration",
        params={"run_id": str(run.id)},
    )
    assert response.status_code == 400


async def test_historical_configuration_requires_view_permission(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
) -> None:
    instance = await make_instance(app_client)
    run = await _capture_run(app_client, db_session, instance["id"])
    response = await app_client.get(
        f"{INSTANCES}/{instance['id']}/configuration",
        params={"run_id": str(run.id)},
        headers=sign(()),
    )
    assert response.status_code == 403
