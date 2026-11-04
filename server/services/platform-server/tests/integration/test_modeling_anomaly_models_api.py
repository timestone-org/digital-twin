"""四类二进制异常模型经过真实版本发布、部署与检测接口。"""

import json
import uuid
from dataclasses import replace

import httpx
import pytest
from conftest import AppContext
from fastapi import FastAPI

from integration.modeling_helpers import (
    PIPELINES,
    RUNS,
    create_pipeline,
    data_of,
    drive_run,
)
from integration.test_modeling_anomaly_api import FIXTURE, NORMAL, seed_normal
from lib.testing import InMemoryCache

pytestmark = pytest.mark.requires_postgres
ALGORITHMS = (
    "isolation_forest",
    "local_outlier_factor",
    "one_class_svm",
    "elliptic_envelope",
)
VERSIONS = "/api/v1/platform/modeling-model-versions"
DEPLOYMENTS = "/api/v1/platform/modeling-deployments"
OPEN = "/api/v1/platform/open-models"


def bind_call_fakes(context: AppContext) -> None:
    transport = context.client._transport
    if not isinstance(transport, httpx.ASGITransport) or not isinstance(
        transport.app, FastAPI
    ):
        raise AssertionError("此验收需要真实ASGI应用")
    application = transport.app
    application.state.container = replace(
        application.state.container,
        object_store=context.object_store,
        cache=InMemoryCache(),
    )


async def served(context: AppContext, algorithm: str) -> dict[str, object]:
    bind_call_fakes(context)
    client = context.client
    code = await seed_normal(client, context.session)
    graph = json.loads(FIXTURE.read_text())
    graph["nodes"][0]["operator"] = "ledger_source"
    graph["nodes"][0]["config"] = {
        "table_code": code,
        "row_source": "manual",
        "since": "2026-10-01T00:00:00Z",
        "until": "2026-10-02T00:00:00Z",
    }
    graph["nodes"][-1]["operator"] = "anomaly_model"
    graph["nodes"][-1]["config"] = {"algorithm": algorithm, "n_estimators": 20}
    pipeline = await create_pipeline(client, "native-anomaly", graph)
    accepted = await client.post(
        f"{PIPELINES}/{pipeline['id']}:run", json={"trigger": "manual"}
    )
    assert accepted.status_code == 202, accepted.text
    run_id = data_of(accepted)["id"]
    await drive_run(context.sessions, uuid.UUID(run_id), context.object_store)
    run = data_of(await client.get(f"{RUNS}/{run_id}"))
    assert run["status"] == "succeeded", run
    response = await client.post(
        VERSIONS, json={"run_id": run_id, "name": "二进制异常模型"}
    )
    assert response.status_code == 201, response.text
    version = data_of(response)
    assert version["task"] == "anomaly_detection"
    assert version["target_key"] is None
    assert version["serving_channel"] == "binary"
    assert version["is_servable"] is True, version["unservable_reason"]
    assert version["signature"]["output"]["key"] == "anomaly_score"
    assert version["metrics"]["test_rows"] == 100
    response = await client.post(
        DEPLOYMENTS,
        json={
            "code": "native-anomaly",
            "model_version_id": version["id"],
            "name": "异常检测",
        },
    )
    assert response.status_code == 201, response.text
    return data_of(response)


@pytest.mark.parametrize("algorithm", ALGORITHMS)
async def test_binary_anomaly_version_serves_real_scores_and_strict_input(
    app_context: AppContext, algorithm: str
) -> None:
    deployment = await served(app_context, algorithm)
    url = f"{OPEN}/{deployment['code']}:detect"
    payload = {"rows": [NORMAL, {"电流": 100.0, "频率": 100.0, "温度": 150.0}]}
    first = await app_context.client.post(url, json=payload)
    assert first.status_code == 200, first.text
    results = data_of(first)["results"]
    assert [item["row"] for item in results] == [0, 1]
    assert results[1]["is_anomaly"] is True
    assert results[1]["score"] > 1
    assert all(item["threshold"] == 1 for item in results)
    repeated = await app_context.client.post(url, json=payload)
    assert repeated.status_code == 200
    assert data_of(repeated)["results"] == results
    missing = await app_context.client.post(
        url, json={"rows": [{"电流": 33.65, "频率": 40.0}]}
    )
    assert missing.status_code == 400
