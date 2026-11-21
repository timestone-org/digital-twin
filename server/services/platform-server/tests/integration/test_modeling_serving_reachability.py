"""模型发布只冻结选定预测路径的步骤。"""

import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.modeling_helpers import (
    LOAD,
    RUNS,
    TEMPERATURE,
    create_pipeline,
    data_of,
    edge,
    linear_graph,
    node,
)
from integration.test_modeling_api import _run_pipeline, _seed_ledger
from integration.test_modeling_instance_lifecycle import DEPLOYMENTS, VERSIONS
from platform_server.apps.modeling.models import ModelingModelVersion

pytestmark = pytest.mark.requires_postgres


def _graph(side_operator: str | None) -> dict[str, Any]:
    """构造带限幅的线性回归图。Args: side_operator。"""
    graph = linear_graph("serving-path-data")
    graph["nodes"].append(node("limit", "clamp_prediction", upper=1400.0))
    graph["edges"][-1:] = [
        edge("score-limit", "m", "scored", "limit", "scored"),
        edge("score-metrics", "limit", "scored", "e", "scored"),
    ]
    if side_operator is not None:
        config = (
            {"threshold": 0.25}
            if side_operator == "clip_outlier"
            else {"lags": [1]}
        )
        graph["nodes"].append(
            node("side", side_operator, columns=[TEMPERATURE], **config)
        )
        graph["edges"].append(edge("branch", "s", "frame", "side", "frame"))
    return graph


@pytest.mark.parametrize("side_operator", [None, "clip_outlier", "lag_feature"])
async def test_a_source_branch_does_not_change_the_deployed_prediction(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    side_operator: str | None,
) -> None:
    await _seed_ledger(app_client, db_session, "serving-path-data")
    pipeline = await create_pipeline(
        app_client, "serving-path", _graph(side_operator)
    )
    run = await _run_pipeline(app_client, worker_sessions, pipeline["id"])
    assert run["status"] == "succeeded"
    response = await app_client.post(
        VERSIONS, json={"run_id": run["id"], "name": "分支验收"}
    )
    assert response.status_code == 201, response.text
    version = data_of(response)
    assert version["is_servable"] is True, version["unservable_reason"]
    published = await app_client.post(
        DEPLOYMENTS,
        json={
            "code": "serving-path",
            "name": "分支验收",
            "model_version_id": version["id"],
        },
    )
    assert published.status_code == 201, published.text
    response = await app_client.post(
        "/api/v1/platform/open-models/serving-path:predict",
        json={
            "rows": [{TEMPERATURE: 40, LOAD: 430}, {TEMPERATURE: 40, LOAD: 600}]
        },
    )
    assert response.status_code == 200, response.text
    assert data_of(response)["predictions"] == pytest.approx([1375, 1400])
    frozen = await db_session.get(
        ModelingModelVersion, uuid.UUID(version["id"])
    )
    assert frozen is not None
    assert [step["node_id"] for step in frozen.serving_json["steps"]] == [
        "f",
        "z",
        "m",
        "limit",
    ]


async def test_publish_preserves_the_first_trained_model_on_a_two_model_graph(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    await _seed_ledger(app_client, db_session, "serving-path-data")
    graph = _graph(None)
    graph["nodes"].extend(
        [
            node(
                "other-model",
                "linear_regression",
                regularization="ridge",
                ridge_alpha=100.0,
            ),
            node("other-limit", "clamp_prediction", upper=1000.0),
        ]
    )
    graph["edges"].extend(
        [
            edge("other-train", "p", "train", "other-model", "train"),
            edge("other-test", "p", "test", "other-model", "test"),
            edge(
                "other-scored", "other-model", "scored", "other-limit", "scored"
            ),
        ]
    )
    pipeline = await create_pipeline(app_client, "two-model-paths", graph)
    run = await _run_pipeline(app_client, worker_sessions, pipeline["id"])
    assert run["status"] == "succeeded"
    for model_node in ("m", "other-model"):
        detail = await app_client.get(f"{RUNS}/{run['id']}/nodes/{model_node}")
        assert detail.status_code == 200
        assert data_of(detail)["status"] == "succeeded"
    response = await app_client.post(
        VERSIONS, json={"run_id": run["id"], "name": "两个模型节点"}
    )
    assert response.status_code == 201, response.text
    version = data_of(response)
    assert version["is_servable"] is True, version["unservable_reason"]
    frozen = await db_session.get(
        ModelingModelVersion, uuid.UUID(version["id"])
    )
    assert frozen is not None
    assert [step["node_id"] for step in frozen.serving_json["steps"]] == [
        "f",
        "z",
        "m",
        "limit",
    ]
