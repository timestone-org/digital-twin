"""BDM 目录权限与流水线源节点在真实事务边界上的装配。"""

import json
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import pytest
from conftest import SignHeaders
from unit.database_fakes import MakerSessions
from unit.modeling_fakes import DirectRunner
from unit.test_modeling_bdm import connection, series_response, success

from integration.modeling_helpers import (
    PIPELINES,
    RUNS,
    create_pipeline,
    edge,
    node,
)
from platform_server.apps.modeling.api import modeling_bdm
from platform_server.apps.modeling.services import bdm_catalog, bdm_frame
from platform_server.apps.modeling.services.bdm_client import (
    BdmClient,
    BdmConnection,
)
from platform_server.apps.modeling.services.run_dispatch import (
    DispatchOptions,
    execute_run,
)
from platform_server.apps.modeling.services.run_pool import NodePool

pytestmark = pytest.mark.requires_postgres
CATALOG = "/api/v1/platform/modeling-bdm-catalogs"


@pytest.fixture
def bdm_pool() -> Iterator[NodePool]:
    """事务装配测试的计算执行器，真实进程由独立契约用例覆盖。"""
    pool = NodePool(factory=lambda: ThreadPoolExecutor(max_workers=1))
    try:
        yield pool
    finally:
        pool.shutdown()


def install_transport(
    monkeypatch: pytest.MonkeyPatch,
    respond: Callable[[httpx.Request], httpx.Response],
) -> None:
    def client(_connection: BdmConnection) -> BdmClient:
        return BdmClient(connection(), transport=httpx.MockTransport(respond))

    monkeypatch.setattr(bdm_frame, "BdmClient", client)
    monkeypatch.setattr(bdm_catalog, "BdmClient", client)
    monkeypatch.setattr(
        modeling_bdm, "configured_connection", lambda _settings: connection()
    )


async def test_catalog_requires_modeling_view_and_returns_platform_envelope(
    app_client: httpx.AsyncClient,
    sign: SignHeaders,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        assert request.url.params["includeUnqueryable"] == "true"
        return success(
            {
                "total": 1,
                "page": 1,
                "pageSize": 50,
                "systemFilterAvailable": False,
                "items": [
                    {
                        "pointId": "p1",
                        "code": "P_1",
                        "name": "温度",
                        "historyAvailable": True,
                    }
                ],
            }
        )

    install_transport(monkeypatch, respond)
    response = await app_client.get(
        CATALOG, params={"name": "温度", "include_unqueryable": True}
    )
    assert response.status_code == 200
    assert response.json()["code"] == 0
    assert response.json()["trace_id"]
    assert response.json()["data"]["items"][0]["identifier"] == "p1"
    response = await app_client.get(CATALOG, headers=sign(codes=()))
    assert response.status_code == 403
    assert len(requests) == 1
    assert "name=%E6%B8%A9%E5%BA%A6" in requests[0]


async def test_system_catalog_uses_same_permission_and_platform_envelope(
    app_client: httpx.AsyncClient,
    sign: SignHeaders,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/points/systems")
        return success({"items": [], "systemFilterAvailable": False})

    install_transport(monkeypatch, respond)
    endpoint = "/api/v1/platform/modeling-bdm-systems"
    response = await app_client.get(endpoint)
    assert response.status_code == 200
    assert response.json()["data"] == {
        "items": [],
        "system_filter_available": False,
    }
    assert response.json()["trace_id"]
    denied = await app_client.get(endpoint, headers=sign(codes=()))
    assert denied.status_code == 403


def graph() -> dict[str, Any]:
    return {
        "format_version": "1.0",
        "nodes": [
            node(
                "source",
                "bdm_source",
                identifiers=["p1"],
                since="2026-10-24T16:00:00Z",
                until="2026-10-25T16:00:00Z",
                row_limit=1,
            ),
            node("select", "select_columns", columns=["p1"]),
        ],
        "edges": [edge("joined", "source", "frame", "select", "frame")],
    }


@pytest.mark.parametrize("is_failing", [False, True])
async def test_worker_loads_bdm_frames_and_persists_node_outcomes(
    app_client: httpx.AsyncClient,
    worker_sessions: MakerSessions,
    monkeypatch: pytest.MonkeyPatch,
    is_failing: bool,
    bdm_pool: NodePool,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["pointIds"] == ["p1"]
        if is_failing:
            return httpx.Response(
                503, json={"code": 503, "message": "external"}
            )
        return series_response(
            [
                {"ct": "2026-10-25 01:00:00", "value": 12.5},
                {"ct": "2026-10-25 00:00:00", "value": 11.5},
            ]
        )

    install_transport(monkeypatch, respond)
    pipeline = await create_pipeline(app_client, f"bdm_{is_failing}", graph())
    started = await app_client.post(
        f"{PIPELINES}/{pipeline['id']}:run", json={"trigger": "manual"}
    )
    assert started.status_code == 202, started.text
    run_id = started.json()["data"]["id"]
    report = await execute_run(
        worker_sessions,
        run_id=uuid.UUID(run_id),
        options=DispatchOptions(
            runner=DirectRunner(),
            tz_offset_minutes=480,
            bdm_connection=connection(),
            pool=bdm_pool,
        ),
    )
    expected = "failed" if is_failing else "succeeded"
    assert report.status == expected
    fetched = await app_client.get(f"{RUNS}/{run_id}")
    details = fetched.json()["data"]
    assert details["status"] == expected
    assert [item["status"] for item in details["nodes"]] == (
        ["failed", "skipped"] if is_failing else ["succeeded", "succeeded"]
    )
    if not is_failing:
        assert details["row_count"] == 1
        assert details["is_source_truncated"] is True
