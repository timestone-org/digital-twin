"""真库训练、发布与第三方异常检测，包含账号鉴权与拒绝路径。"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.anomaly_fakes import normal_frame
from unit.database_fakes import MakerSessions

from integration.dataset_helpers import create_column, create_table
from integration.modeling_helpers import create_pipeline, data_of
from integration.test_modeling_api import _run_pipeline
from integration.test_modeling_formula_seam import _publish
from integration.test_modeling_open_api import _served
from lib.utils.ids import uuid7
from platform_server.apps.dataset.models import DatasetRecord

pytestmark = pytest.mark.requires_postgres
DEPLOYMENTS = "/api/v1/platform/modeling-deployments"
OPEN = "/api/v1/platform/open-models"
FIXTURE = (
    Path(__file__).resolve().parents[5]
    / "web/app/tests/pages/Modeling/fixtures/deviceAnomalyGraph.json"
)
NORMAL = {"电流": 33.65, "频率": 40, "温度": 71}


async def seed_normal(client: httpx.AsyncClient, session: AsyncSession) -> str:
    table = await create_table(client, code="anomaly_history", name="正常工况")
    sample = normal_frame()
    for key in sample.keys:
        await create_column(client, str(table["id"]), key=key, name=key)
    for seat, row in enumerate(sample.rows):
        session.add(
            DatasetRecord(
                table_id=uuid.UUID(str(table["id"])),
                row_id=uuid7(),
                ts=datetime(2026, 10, 1, tzinfo=UTC) + timedelta(minutes=seat),
                values_json=dict(zip(sample.keys, row, strict=True)),
                source="manual",
            )
        )
    await session.commit()
    return str(table["code"])


@pytest.fixture
async def anomaly_service(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> tuple[dict[str, Any], dict[str, str]]:
    code = await seed_normal(app_client, db_session)
    graph = json.loads(FIXTURE.read_text())
    graph["nodes"][0]["config"] = {
        "table_code": code,
        "row_source": "manual",
        "since": "2026-10-01T00:00:00Z",
        "until": "2026-10-02T00:00:00Z",
    }
    pipeline = await create_pipeline(app_client, "device_anomaly", graph)
    run = await _run_pipeline(app_client, worker_sessions, pipeline["id"])
    assert run["status"] == "succeeded", run
    version = await _publish(app_client, run["id"], "设备异常检测")
    assert version["is_servable"] is True
    assert version["target_key"] is None
    assert version["task"] == "anomaly_detection"
    response = await app_client.post(
        DEPLOYMENTS,
        json={
            "code": "device-anomaly",
            "model_version_id": version["id"],
            "name": "设备检测",
            "rate_limit_per_minute": 60,
        },
    )
    assert response.status_code == 201, response.text
    deployment = dict(data_of(response))
    return deployment, dict(app_client.headers)


async def test_third_party_receives_boolean_for_normal_and_joint_anomalies(
    app_client: httpx.AsyncClient,
    anomaly_service: tuple[dict[str, Any], dict[str, str]],
) -> None:
    deployment, caller_headers = anomaly_service
    rows = [
        NORMAL,
        {**NORMAL, "电流": 70},
        {**NORMAL, "温度": 150},
        {"温度": 68, "电流": 37, "频率": 33},
    ]
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:detect",
        json={"rows": rows},
        headers=caller_headers,
    )
    assert response.status_code == 200, response.text
    answer = data_of(response)
    assert [item["is_anomaly"] for item in answer["results"]] == [
        False,
        True,
        True,
        True,
    ]
    assert [item["row"] for item in answer["results"]] == [0, 1, 2, 3]
    assert all(item["threshold"] == 1 for item in answer["results"])
    assert answer["model"]["version"] == 1
    assert response.json()["trace_id"]


@pytest.mark.parametrize(
    "row",
    [
        {"电流": 33.65, "频率": 40},
        {**NORMAL, "温度": None},
        {**NORMAL, "温度": "71"},
        {**NORMAL, "温度": True},
        {**NORMAL, "extra": 1},
    ],
)
async def test_invalid_sensor_row_is_rejected_not_reported_as_normal(
    app_client: httpx.AsyncClient,
    anomaly_service: tuple[dict[str, Any], dict[str, str]],
    row: dict[str, object],
) -> None:
    deployment, caller_headers = anomaly_service
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:detect",
        json={"rows": [row]},
        headers=caller_headers,
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] != 0


async def test_detection_requires_account_auth_and_respects_disabled_services(
    app_client: httpx.AsyncClient,
    anomaly_service: tuple[dict[str, Any], dict[str, str]],
) -> None:
    deployment, caller_headers = anomaly_service
    url = f"{OPEN}/{deployment['code']}:detect"
    assert (
        await app_client.post(
            url, json={"rows": [NORMAL]}, headers={"X-Auth-Sig": ""}
        )
    ).status_code == 401
    await app_client.patch(
        f"{DEPLOYMENTS}/{deployment['id']}", json={"is_enabled": False}
    )
    assert (
        await app_client.post(
            url, json={"rows": [NORMAL]}, headers=caller_headers
        )
    ).status_code == 403


async def test_supervised_model_is_rejected_by_detection(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    deployment, caller_headers = await _served(
        app_client, db_session, worker_sessions, "normal-regression"
    )
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:detect",
        json={"rows": [NORMAL]},
        headers=caller_headers,
    )
    assert response.status_code == 400


async def test_detect_limits_batch_size_and_rate(
    app_client: httpx.AsyncClient,
    anomaly_service: tuple[dict[str, Any], dict[str, str]],
) -> None:
    deployment, caller_headers = anomaly_service
    url = f"{OPEN}/{deployment['code']}:detect"
    response = await app_client.post(
        url, json={"rows": [NORMAL] * 257}, headers=caller_headers
    )
    assert response.status_code == 400
    response = await app_client.patch(
        f"{DEPLOYMENTS}/{deployment['id']}",
        json={"max_rows_per_call": 1, "rate_limit_per_minute": 2},
    )
    assert response.status_code == 200
    assert (
        await app_client.post(
            url, json={"rows": [NORMAL] * 2}, headers=caller_headers
        )
    ).status_code == 400
    assert (
        await app_client.post(
            url, json={"rows": [NORMAL]}, headers=caller_headers
        )
    ).status_code == 429
