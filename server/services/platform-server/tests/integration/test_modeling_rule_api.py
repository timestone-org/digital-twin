"""真库规则发布、结构化调用、拒绝边界与旧读取存储兼容。"""

import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions
from unit.source_fakes import InMemoryStream

from integration.dataset_helpers import (
    create_column,
    create_record,
    create_table,
)
from integration.modeling_helpers import create_pipeline, data_of
from integration.test_modeling_api import _run_pipeline
from integration.test_modeling_formula_seam import _publish
from integration.test_modeling_open_api import DEPLOYMENTS, OPEN, _served
from lib.db import run_after_commit_hooks
from lib.stream import StreamGroup
from platform_server.apps.modeling.models import (
    ModelingDeployment,
    ModelingModelVersion,
    ModelingRuleVersion,
)
from platform_server.apps.modeling.schemas import RunStartIn
from platform_server.apps.modeling.services import open_model_service
from platform_server.apps.modeling.services.open_model_service import (
    OpenModelDeps,
    ResolvedCall,
)
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.run_service import (
    RunContext,
    start_run,
)
from platform_server.settings import Settings

pytestmark = pytest.mark.requires_postgres
VERSIONS = "/api/v1/platform/modeling-model-versions"


async def _rule_table(client: httpx.AsyncClient) -> dict[str, Any]:
    table = await create_table(client, code="unit_energy", name="班次能耗核算")
    for key in ("能耗", "产量", "无关列"):
        await create_column(client, str(table["id"]), key=key, name=key)
    await create_record(
        client,
        str(table["id"]),
        ts="2026-10-01T00:00:00Z",
        values={"能耗": "0.3", "产量": "0.1", "无关列": "99"},
    )
    return table


async def _rule_version(
    client: httpx.AsyncClient, sessions: MakerSessions
) -> dict[str, Any]:
    table = await _rule_table(client)
    graph = {
        "format_version": "1.0",
        "nodes": [
            {
                "id": "source",
                "operator": "ledger_source",
                "config": {
                    "table_code": table["code"],
                    "row_source": "manual",
                    "since": "2026-10-01T00:00:00Z",
                    "until": "2026-10-02T00:00:00Z",
                },
            },
            {
                "id": "rule",
                "operator": "energy_rules",
                "config": {"kind": "unit_consumption"},
            },
        ],
        "edges": [
            {
                "id": "source-rule",
                "from_node": "source",
                "from_port": "frame",
                "to_node": "rule",
                "to_port": "frame",
            }
        ],
    }
    pipeline = await create_pipeline(client, "unit-energy", graph)
    run = await _run_pipeline(client, sessions, pipeline["id"])
    assert run["status"] == "succeeded", run
    version = await _publish(client, run["id"], "单位能耗核算模型")
    assert version["is_servable"] is True, version
    assert version["task"] == "rule_calculation"
    assert version["target_key"] is None
    assert {item["key"] for item in version["signature"]["inputs"]} == {
        "能耗",
        "产量",
    }
    return version


@pytest.fixture
async def rule_service(
    app_client: httpx.AsyncClient, worker_sessions: MakerSessions
) -> tuple[dict[str, Any], dict[str, str]]:
    version = await _rule_version(app_client, worker_sessions)
    created = await app_client.post(
        DEPLOYMENTS,
        json={
            "code": "unit-energy",
            "model_version_id": version["id"],
            "name": "单位能耗核算服务",
        },
    )
    assert created.status_code == 201, created.text
    deployment = dict(data_of(created))
    return deployment, dict(app_client.headers)


async def test_rule_calculation_returns_exact_decimal_and_business_details(
    app_client: httpx.AsyncClient,
    rule_service: tuple[dict[str, Any], dict[str, str]],
) -> None:
    deployment, caller_headers = rule_service
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:calculate",
        json={"rows": [{"能耗": 0.3, "产量": 0.1}]},
        headers=caller_headers,
    )
    assert response.status_code == 200, response.text
    answer = data_of(response)
    assert answer["results"][0]["unit_consumption"] == "3"
    assert answer["results"][0]["calculation_method"] == "deterministic_rule"
    assert answer["model"]["version"] == deployment["model_version"]
    assert response.json()["trace_id"]
    stats = data_of(
        await app_client.get(f"{DEPLOYMENTS}/{deployment['id']}/call-stats")
    )
    assert stats[0]["total"] == 1
    assert stats[0]["failed"] == 0


@pytest.mark.parametrize(
    "row",
    [
        {"能耗": 10},
        {"能耗": 10, "产量": None},
        {"能耗": 10, "产量": "NaN"},
        {"能耗": 10, "产量": "Infinity"},
        {"能耗": 10, "产量": " 2 "},
        {"能耗": 10, "产量": "1e100"},
        {"能耗": 10, "产量": "1e-100"},
        {"能耗": 10, "产量": True},
        {"能耗": 10, "产量": 0},
        {"能耗": -10, "产量": 2},
        {"能耗": 10, "产量": 2, "无关列": 0},
    ],
)
async def test_bad_inputs_are_rejected_instead_of_computed(
    app_client: httpx.AsyncClient,
    rule_service: tuple[dict[str, Any], dict[str, str]],
    row: dict[str, object],
) -> None:
    deployment, caller_headers = rule_service
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:calculate",
        json={"rows": [row]},
        headers=caller_headers,
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] != 0


async def test_rule_and_trained_versions_keep_legacy_store_readable_and_page(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    rule_service: tuple[dict[str, Any], dict[str, str]],
) -> None:
    deployment, _key = rule_service
    await _served(app_client, db_session, worker_sessions, "trained-version")
    trained_count = await db_session.scalar(
        select(func.count()).select_from(ModelingModelVersion)
    )
    rule_count = await db_session.scalar(
        select(func.count()).select_from(ModelingRuleVersion)
    )
    assert trained_count == 1
    assert rule_count == 1
    first = data_of(await app_client.get(VERSIONS, params={"size": 1}))
    second = data_of(
        await app_client.get(VERSIONS, params={"size": 1, "page": 2})
    )
    assert first["total"] == second["total"] == 2
    assert first["items"][0]["id"] != second["items"][0]["id"]
    legacy = await db_session.scalars(select(ModelingModelVersion.task))
    assert set(legacy.all()) <= {
        "anomaly_detection",
        "classification",
        "regression",
    }
    rule_row = await db_session.get(ModelingDeployment, deployment["id"])
    assert rule_row is not None
    assert rule_row.model_version_id is None
    assert str(rule_row.rule_version_id) == deployment["model_version_id"]
    listed = data_of(await app_client.get(DEPLOYMENTS))
    assert len(listed) == 2


async def test_rules_require_account_auth_and_reject_numeric_prediction(
    app_client: httpx.AsyncClient,
    rule_service: tuple[dict[str, Any], dict[str, str]],
) -> None:
    deployment, caller_headers = rule_service
    rows = {"rows": [{"能耗": 6, "产量": 2}]}
    url = f"{OPEN}/{deployment['code']}"
    assert (
        await app_client.post(
            f"{url}:calculate", json=rows, headers={"X-Auth-Sig": ""}
        )
    ).status_code == 401
    predicted = await app_client.post(
        f"{url}:predict", json=rows, headers=caller_headers
    )
    assert predicted.status_code == 400, predicted.text
    registered = await app_client.post(
        f"{VERSIONS}/{deployment['model_version_id']}:register-formula",
        json={"fx_code": "单位能耗"},
    )
    assert registered.status_code == 409, registered.text
    await app_client.patch(
        f"{DEPLOYMENTS}/{deployment['id']}", json={"is_enabled": False}
    )
    assert (
        await app_client.post(
            f"{url}:calculate", json=rows, headers=caller_headers
        )
    ).status_code == 403


async def test_rule_run_is_enqueued_only_on_the_rule_stream(
    app_client: httpx.AsyncClient,
    worker_sessions: MakerSessions,
    db_session: AsyncSession,
    stream: InMemoryStream,
    settings: Settings,
) -> None:
    version = await _rule_version(app_client, worker_sessions)
    await start_run(
        db_session,
        pipeline_id=uuid.UUID(version["pipeline_id"]),
        payload=RunStartIn(),
        context=RunContext(
            actor=Actor(user_id=str(uuid.uuid4()), name="管理员"),
            stream=stream,
            target=StreamGroup(
                stream=settings.modeling_stream,
                group=settings.modeling_group,
                consumer="api",
            ),
            now=datetime.now(UTC),
        ),
    )
    await db_session.commit()
    await run_after_commit_hooks(db_session)
    assert len(stream.entries) == 1
    assert stream.entries[0].entry_id.startswith(
        f"{settings.modeling_stream}:rules:"
    )
    assert stream.entries[0].fields["traceparent"]


async def test_decimal_inputs_keep_precision_before_rule_arithmetic(
    app_client: httpx.AsyncClient,
    rule_service: tuple[dict[str, Any], dict[str, str]],
) -> None:
    deployment, caller_headers = rule_service
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:calculate",
        json={
            "rows": [
                {"能耗": "10000000000000000.1", "产量": "0.1"},
                {"能耗": "0.3", "产量": "0.1"},
            ]
        },
        headers=caller_headers,
    )
    assert response.status_code == 200, response.text
    results = data_of(response)["results"]
    assert [item["unit_consumption"] for item in results] == [
        "100000000000000001",
        "3",
    ]


async def test_invalid_decimal_range_is_recorded_before_client_error(
    app_client: httpx.AsyncClient,
    rule_service: tuple[dict[str, Any], dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deployment, caller_headers = rule_service
    recorded: list[tuple[int, int | None]] = []
    original = open_model_service.record_call

    async def record(
        deps: OpenModelDeps,
        resolved: ResolvedCall,
        started: float,
        status: int,
        error_code: int | None,
    ) -> None:
        recorded.append((status, error_code))
        await original(deps, resolved, started, status, error_code)

    monkeypatch.setattr(open_model_service, "record_call", record)
    response = await app_client.post(
        f"{OPEN}/{deployment['code']}:calculate",
        json={"rows": [{"能耗": 10, "产量": "1e100"}]},
        headers=caller_headers,
    )
    assert response.status_code == 400, response.text
    assert recorded == [(400, 41423)]
