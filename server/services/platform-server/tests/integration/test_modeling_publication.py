"""发布完整走过训练、数据库约束和对外预测，缺失产物给出明确状态。"""

import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.modeling_helpers import (
    create_pipeline,
    data_of,
    edge,
    linear_graph,
    node,
)
from integration.test_modeling_api import _run_pipeline, _seed_ledger
from platform_server.apps.modeling.models import ModelingNodeRun

pytestmark = pytest.mark.requires_postgres

VERSIONS = "/api/v1/platform/modeling-model-versions"
DEPLOYMENTS = "/api/v1/platform/modeling-deployments"
OPEN = "/api/v1/platform/open-models"


async def _trained(
    client: httpx.AsyncClient,
    session: AsyncSession,
    sessions: MakerSessions,
) -> dict[str, Any]:
    await _seed_ledger(client, session, "publication_energy")
    graph = linear_graph("publication_energy")
    graph["nodes"] = [
        item for item in graph["nodes"] if item["id"] not in {"f", "z"}
    ]
    graph["nodes"].insert(1, node("d", "drop_missing"))
    graph["edges"] = [
        item for item in graph["edges"] if item["id"] not in {"e1", "e2", "e3"}
    ]
    graph["edges"].extend(
        [
            edge("sd", "s", "frame", "d", "frame"),
            edge("dp", "d", "frame", "p", "frame"),
        ]
    )
    pipeline = await create_pipeline(client, "publication", graph)
    run = await _run_pipeline(client, sessions, pipeline["id"])
    assert run["status"] == "succeeded"
    return run


async def _predict(
    client: httpx.AsyncClient, version_id: str
) -> httpx.Response:
    response = await client.post(
        DEPLOYMENTS,
        json={
            "code": "publication",
            "name": "预测",
            "model_version_id": version_id,
        },
    )
    assert response.status_code == 201, response.text
    minted = await client.post(
        f"{DEPLOYMENTS}/{data_of(response)['id']}/api-keys",
        json={"name": "对接测试"},
    )
    assert minted.status_code == 201, minted.text
    return await client.post(
        f"{OPEN}/publication:predict",
        headers={"X-Api-Key": data_of(minted)["plaintext"]},
        json={"rows": [{"温度": 25.0, "负荷": 430.0}]},
    )


async def test_model_only_chain_publishes_and_serves_predictions(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    run = await _trained(app_client, db_session, worker_sessions)
    response = await app_client.post(
        VERSIONS, json={"run_id": run["id"], "name": "能耗"}
    )

    assert response.status_code == 201, response.text
    version = data_of(response)
    assert version["is_servable"] is True
    assert version["target_key"] == "能耗"
    predicted = await _predict(app_client, version["id"])
    assert predicted.status_code == 200, predicted.text
    assert data_of(predicted)["predictions"] == pytest.approx([1345.0])


async def test_missing_io_publishes_unservable_version_with_model_identity(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    run = await _trained(app_client, db_session, worker_sessions)
    model = await db_session.scalar(
        select(ModelingNodeRun).where(
            ModelingNodeRun.run_id == uuid.UUID(run["id"]),
            ModelingNodeRun.node_id == "m",
        )
    )
    assert model is not None
    model.io_json = {}
    await db_session.commit()
    response = await app_client.post(
        VERSIONS, json={"run_id": run["id"], "name": "待重训"}
    )

    assert response.status_code == 201, response.text
    version = data_of(response)
    assert version["is_servable"] is False
    assert "列记录" in version["unservable_reason"]
    assert version["target_key"] == "能耗"
    assert version["algo"] == "linear_regression"


async def test_run_without_model_returns_domain_error(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    await _seed_ledger(app_client, db_session, "no_model_energy")
    graph = linear_graph("no_model_energy")
    graph["nodes"] = [graph["nodes"][0]]
    graph["edges"] = []
    pipeline = await create_pipeline(app_client, "no-model", graph)
    run = await _run_pipeline(app_client, worker_sessions, pipeline["id"])
    response = await app_client.post(
        VERSIONS, json={"run_id": run["id"], "name": "无模型"}
    )

    assert response.status_code == 409, response.text
    assert response.json()["code"] == 41410
    assert "没有建模算子" in response.json()["message"]
