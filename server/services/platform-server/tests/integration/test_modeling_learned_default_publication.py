"""训练均值可以随兼容模型更新，手工值与缺失策略继续受签名保护。"""

import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.modeling_helpers import (
    ENERGY,
    LOAD,
    PIPELINES,
    RUNS,
    TEMPERATURE,
    create_pipeline,
    data_of,
    drive_run,
    linear_graph,
)
from integration.test_modeling_api import _run_pipeline, _seed_ledger
from integration.test_modeling_instance_lifecycle import DEPLOYMENTS, VERSIONS
from platform_server.apps.dataset.models import DatasetRecord, DatasetTable
from platform_server.apps.modeling.models import ModelingModelVersion

pytestmark = pytest.mark.requires_postgres
TABLE = "learned-default-data"
PREDICT = "/api/v1/platform/open-models/learned-default:predict"


async def _initial_deployment(
    client: httpx.AsyncClient,
    session: AsyncSession,
    sessions: MakerSessions,
    strategy: str,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """保存并部署版本。Args: client, session, sessions, strategy。"""
    await _seed_ledger(client, session, TABLE)
    graph = linear_graph(TABLE)
    graph["nodes"][1]["config"] = {
        "columns": [TEMPERATURE],
        "strategy": strategy,
        "value": 30.0,
    }
    pipeline = await create_pipeline(client, "learned-default", graph)
    run = await _run_pipeline(client, sessions, pipeline["id"])
    assert run["status"] == "succeeded"
    response = await client.post(
        VERSIONS, json={"run_id": run["id"], "name": "原版本"}
    )
    assert response.status_code == 201, response.text
    version = data_of(response)
    deployed = await client.post(
        DEPLOYMENTS,
        json={
            "code": "learned-default",
            "name": "缺省策略验收",
            "model_version_id": version["id"],
        },
    )
    assert deployed.status_code == 201, deployed.text
    return graph, pipeline, data_of(deployed)


async def _auto_train(
    client: httpx.AsyncClient, sessions: MakerSessions, pipeline_id: str
) -> dict[str, Any]:
    """按正常工作流运行自动发布。Args: client, sessions, pipeline_id。"""
    accepted = await client.post(
        f"{PIPELINES}/{pipeline_id}:run",
        json={"trigger": "manual", "auto_publish": True},
    )
    assert accepted.status_code == 202, accepted.text
    run_id = data_of(accepted)["id"]
    await drive_run(sessions, uuid.UUID(run_id))
    return dict(data_of(await client.get(f"{RUNS}/{run_id}")))


async def _temperature_shift(session: AsyncSession) -> None:
    """改变均值并保留线性关系与原有时间窗。Args: session。"""
    rows = await session.scalars(
        select(DatasetRecord)
        .join(DatasetTable, DatasetTable.id == DatasetRecord.table_id)
        .where(DatasetTable.code == TABLE)
    )
    for row in rows:
        values = dict(row.values_json)
        assert isinstance(values[TEMPERATURE], (int, float))
        assert isinstance(values[ENERGY], (int, float))
        values[TEMPERATURE] += 8
        values[ENERGY] += 16
        row.values_json = values
    await session.commit()


async def _predict_missing(client: httpx.AsyncClient) -> list[float]:
    """调用实际部署，分别省略温度与传入空值。Args: client。"""
    response = await client.post(
        PREDICT, json={"rows": [{LOAD: 430}, {TEMPERATURE: None, LOAD: 430}]}
    )
    assert response.status_code == 200, response.text
    return list(data_of(response)["predictions"])


async def test_auto_publication_uses_retrained_mean_for_missing_input(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    _, pipeline, deployed = await _initial_deployment(
        app_client, db_session, worker_sessions, "mean"
    )
    before = await _predict_missing(app_client)
    await _temperature_shift(db_session)

    trained = await _auto_train(app_client, worker_sessions, pipeline["id"])

    assert trained["status"] == "succeeded"
    assert trained["publication_status"] == "published", trained[
        "publication_error"
    ]
    current = data_of(await app_client.get(f"{DEPLOYMENTS}/{deployed['id']}"))
    assert current["revision"] == deployed["revision"] + 1
    assert current["model_version_id"] == trained["published_version_id"]
    assert current["model_version_id"] != deployed["model_version_id"]
    assert await _predict_missing(app_client) == pytest.approx(
        [value + 16 for value in before]
    )


@pytest.mark.parametrize(
    "change", ["constant-value", "same-value-strategy", "require-input"]
)
async def test_policy_changes_require_confirmation(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    change: str,
) -> None:
    graph, pipeline, deployed = await _initial_deployment(
        app_client,
        db_session,
        worker_sessions,
        "constant" if change == "constant-value" else "mean",
    )
    original_version = deployed["model_version_id"]
    model = await db_session.get(
        ModelingModelVersion, uuid.UUID(original_version)
    )
    assert model is not None
    original_default = model.signature_json["inputs"][0]["default_on_missing"]
    if change == "require-input":
        graph["nodes"].pop(1)
        graph["edges"][:2] = [
            {
                "id": "source-to-scale",
                "from_node": "s",
                "from_port": "frame",
                "to_node": "z",
                "to_port": "frame",
            },
        ]
    else:
        graph["nodes"][1]["config"].update(
            strategy="constant",
            value=35.0 if change == "constant-value" else original_default,
        )
    updated = await app_client.patch(
        f"{PIPELINES}/{pipeline['id']}", json={"graph": graph}
    )
    assert updated.status_code == 200, updated.text
    trained = await _auto_train(app_client, worker_sessions, pipeline["id"])
    assert trained["status"] == "succeeded"
    assert trained["publication_status"] == "failed"
    assert "签名" in trained["publication_error"]
    current = data_of(await app_client.get(f"{DEPLOYMENTS}/{deployed['id']}"))
    assert current["revision"] == deployed["revision"]
    assert current["model_version_id"] == original_version
    if change == "constant-value":
        await _confirm_fixed_default(app_client, db_session, deployed, trained)


async def _confirm_fixed_default(
    client: httpx.AsyncClient,
    session: AsyncSession,
    deployed: dict[str, Any],
    trained: dict[str, Any],
) -> None:
    """校验手工缺省须确认。Args: client, session, deployed, trained。"""
    target = await session.scalar(
        select(ModelingModelVersion.id).where(
            ModelingModelVersion.run_id == uuid.UUID(trained["id"])
        )
    )
    assert target is not None
    endpoint = f"{DEPLOYMENTS}/{deployed['id']}:switch"
    payload = {
        "expected_revision": deployed["revision"],
        "model_version_id": str(target),
    }
    assert (await client.post(endpoint, json=payload)).status_code == 409
    assert await _predict_missing(client) == pytest.approx([1355, 1355])
    confirmed = await client.post(
        endpoint, json={**payload, "is_signature_change_confirmed": True}
    )
    assert confirmed.status_code == 200, confirmed.text
    assert await _predict_missing(client) == pytest.approx([1365, 1365])


async def test_auto_publication_does_not_assume_an_unknown_default_was_learned(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    _, pipeline, deployed = await _initial_deployment(
        app_client, db_session, worker_sessions, "mean"
    )
    original_version = deployed["model_version_id"]
    model = await db_session.get(
        ModelingModelVersion, uuid.UUID(original_version)
    )
    assert model is not None
    serving = dict(model.serving_json)
    leading, *remaining = serving["steps"]
    serving["steps"] = [
        {key: value for key, value in leading.items() if key != "config"},
        *remaining,
    ]
    model.serving_json = serving
    await _temperature_shift(db_session)

    trained = await _auto_train(app_client, worker_sessions, pipeline["id"])

    assert trained["status"] == "succeeded"
    assert trained["publication_status"] == "failed"
    assert "签名" in trained["publication_error"]
    current = data_of(await app_client.get(f"{DEPLOYMENTS}/{deployed['id']}"))
    assert current["model_version_id"] == original_version
