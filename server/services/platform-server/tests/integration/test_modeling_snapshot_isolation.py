"""排队、发布与部署始终使用各自冻结的图和模型版本。"""

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.modeling_helpers import (
    ENERGY,
    LOAD,
    PIPELINES,
    TEMPERATURE,
    create_pipeline,
    data_of,
    drive_run,
    edge,
    node,
)
from integration.test_modeling_api import _seed_ledger
from lib.web import Page
from platform_server.apps.modeling.schemas import (
    ModelVersionOut,
    ModelVersionSummaryOut,
    OpenModelPredictOut,
    PipelineGraph,
    RunOut,
)

pytestmark = pytest.mark.requires_postgres

TABLE = "snapshot-isolation-data"
VERSIONS = "/api/v1/platform/modeling-model-versions"
DEPLOYMENTS = "/api/v1/platform/modeling-deployments"
OPEN = "/api/v1/platform/open-models"


def _graph(target: str, table_code: str = TABLE) -> PipelineGraph:
    return PipelineGraph.model_validate(
        {
            "format_version": "1.0",
            "nodes": [
                node(
                    "source",
                    "ledger_source",
                    table_code=table_code,
                    columns=[TEMPERATURE, LOAD, ENERGY],
                ),
                node("clean", "drop_missing"),
                node("split", "split_dataset", target_column=target),
                node("model", "linear_regression"),
                node("metrics", "regression_metrics"),
            ],
            "edges": [
                edge("source-clean", "source", "frame", "clean", "frame"),
                edge("clean-split", "clean", "frame", "split", "frame"),
                edge("split-train", "split", "train", "model", "train"),
                edge("split-test", "split", "test", "model", "test"),
                edge("model-metrics", "model", "scored", "metrics", "scored"),
            ],
        }
    )


async def _start(client: httpx.AsyncClient, pipeline_id: str) -> RunOut:
    response = await client.post(
        f"{PIPELINES}/{pipeline_id}:run", json={"trigger": "manual"}
    )
    assert response.status_code == 202, response.text
    run = RunOut.model_validate(data_of(response))
    assert run.status == "pending"
    return run


async def _edit(
    client: httpx.AsyncClient, pipeline_id: str, graph: PipelineGraph
) -> None:
    response = await client.patch(
        f"{PIPELINES}/{pipeline_id}",
        json={"graph": graph.model_dump(mode="json")},
    )
    assert response.status_code == 200, response.text


async def _publish(client: httpx.AsyncClient, run: RunOut) -> ModelVersionOut:
    response = await client.post(
        VERSIONS, json={"run_id": str(run.id), "name": "快照模型"}
    )
    assert response.status_code == 201, response.text
    version = ModelVersionOut.model_validate(data_of(response))
    assert version.is_servable is True
    return version


async def _deploy(
    client: httpx.AsyncClient, version: ModelVersionOut, code: str
) -> None:
    response = await client.post(
        DEPLOYMENTS,
        json={
            "model_version_id": str(version.id),
            "code": code,
            "name": "快照服务",
        },
    )
    assert response.status_code == 201, response.text


async def _assert_prediction(
    client: httpx.AsyncClient, code: str, version: int, expected: float
) -> None:
    response = await client.post(
        f"{OPEN}/{code}:predict",
        json={"rows": [{TEMPERATURE: 25, LOAD: 430, ENERGY: 1345}]},
    )
    assert response.status_code == 200, response.text
    result = OpenModelPredictOut.model_validate(data_of(response))
    assert result.model.version == version
    assert result.predictions == pytest.approx([expected])


async def test_source_edits_preserve_queued_and_deployed_models(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    await _seed_ledger(app_client, db_session, TABLE)
    pipeline = await create_pipeline(
        app_client, "snapshot-isolation", _graph(ENERGY).model_dump(mode="json")
    )
    pipeline_id = str(pipeline["id"])
    first_run = await _start(app_client, pipeline_id)
    await _edit(app_client, pipeline_id, _graph(LOAD))
    first_result = await drive_run(worker_sessions, first_run.id)
    assert first_result.status == "succeeded"
    first = await _publish(app_client, first_run)
    assert first.target_key == ENERGY
    assert first.version == 1
    await _deploy(app_client, first, "snapshot-original")
    await _assert_prediction(app_client, "snapshot-original", 1, 1345)

    second_run = await _start(app_client, pipeline_id)
    second_result = await drive_run(worker_sessions, second_run.id)
    assert second_result.status == "succeeded"
    second = await _publish(app_client, second_run)
    assert second.target_key == LOAD
    assert second.version == 2
    assert first.id != second.id
    await _deploy(app_client, second, "snapshot-retrained")
    await _edit(app_client, pipeline_id, _graph(ENERGY, "missing-data"))

    listed = await app_client.get(VERSIONS, params={"pipeline_id": pipeline_id})
    assert listed.status_code == 200, listed.text
    versions = Page[ModelVersionSummaryOut].model_validate(data_of(listed))
    assert {item.id for item in versions.items} == {first.id, second.id}
    deletion = await app_client.delete(f"{PIPELINES}/{pipeline_id}")
    assert deletion.status_code == 409, deletion.text
    await _assert_prediction(app_client, "snapshot-original", 1, 1345)
    await _assert_prediction(app_client, "snapshot-retrained", 2, 430)
