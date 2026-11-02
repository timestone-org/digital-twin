"""部署列表与详情从固定版本返回任务类型，不跟随较新的模型版本。"""

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_helpers import data_of
from integration.test_modeling_open_api import DEPLOYMENTS
from lib.utils.ids import uuid7
from platform_server.apps.modeling.models import (
    ModelingModelVersion,
    ModelingPipeline,
    ModelingRuleVersion,
    ModelingRun,
    ModelVersion,
)
from platform_server.apps.modeling.protocols import ModelTask

pytestmark = pytest.mark.requires_postgres


async def _seed_version(
    session: AsyncSession,
    pipeline: ModelingPipeline,
    task: ModelTask,
    number: int = 1,
) -> ModelVersion:
    run = ModelingRun(
        pipeline_id=pipeline.id,
        status="succeeded",
        trigger="manual",
        graph_snapshot={},
    )
    session.add(run)
    await session.flush()
    model = (
        ModelingRuleVersion
        if task == "rule_calculation"
        else ModelingModelVersion
    )
    version = model(
        pipeline_id=pipeline.id,
        run_id=run.id,
        version=number,
        name="固定模型",
        algo=(
            "energy_rules"
            if task == "rule_calculation"
            else "linear_regression"
        ),
        task=task,
        servable=True,
        serving_channel="json",
        serving_json={},
        signature_json={},
        feature_keys=["input"],
        target_key=(
            "target" if task in {"regression", "classification"} else None
        ),
        metrics_json={},
        fingerprint_json={},
    )
    session.add(version)
    await session.flush()
    return version


@pytest.mark.parametrize(
    "task",
    ["regression", "classification", "anomaly_detection", "rule_calculation"],
)
async def test_deployment_outputs_identify_the_pinned_model_task(
    app_client: httpx.AsyncClient, db_session: AsyncSession, task: ModelTask
) -> None:
    pipeline = ModelingPipeline(
        code=f"task-{uuid7()}", name="任务类型", graph_json={}
    )
    db_session.add(pipeline)
    await db_session.flush()
    version = await _seed_version(db_session, pipeline, task)
    response = await app_client.post(
        DEPLOYMENTS,
        json={
            "code": task.replace("_", "-"),
            "name": "任务服务",
            "model_version_id": str(version.id),
        },
    )
    assert response.status_code == 201, response.text
    deployment = data_of(response)
    assert deployment["task"] == task
    newer_task = "classification" if task == "regression" else "regression"
    await _seed_version(db_session, pipeline, newer_task, number=2)
    url = f"{DEPLOYMENTS}/{deployment['id']}"
    assert data_of(await app_client.get(url))["task"] == task
    assert [
        item["task"] for item in data_of(await app_client.get(DEPLOYMENTS))
    ] == [task]
    updated = await app_client.patch(url, json={"name": "改名后的服务"})
    assert updated.status_code == 200, updated.text
    assert data_of(updated)["task"] == task
