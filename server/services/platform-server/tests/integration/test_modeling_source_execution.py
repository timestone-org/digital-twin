"""源节点与诊断分支经过 HTTP、worker 和真实隔离数据库的执行验收。"""

import csv
import io
import json
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from conftest import AppContext
from unit.modeling_fakes import DirectRunner
from unit.test_modeling_bdm import connection, success

from integration.dataset_helpers import (
    create_column,
    create_record,
    create_table,
)
from integration.modeling_helpers import (
    PIPELINES,
    RUNS,
    create_pipeline,
    data_of,
    drive_run,
    edge,
    linear_graph,
    node,
)
from integration.test_modeling_api import _seed_ledger
from integration.test_modeling_bdm import install_transport
from platform_server.apps.modeling.services.run_dispatch import (
    DispatchOptions,
    execute_run,
)
from platform_server.apps.modeling.services.run_pool import NodePool

pytestmark = pytest.mark.requires_postgres


@pytest.fixture
def assembly_pool() -> Iterator[NodePool]:
    pool = NodePool(factory=lambda: ThreadPoolExecutor(max_workers=1))
    try:
        yield pool
    finally:
        pool.shutdown()


async def seed_pair(
    context: AppContext, code: str, values: tuple[int, int]
) -> str:
    table = await create_table(context.client, code=code, name=code)
    await create_column(
        context.client, str(table["id"]), key="value", name="读数"
    )
    for hour, value in enumerate(values):
        await create_record(
            context.client,
            str(table["id"]),
            ts=f"2026-01-02T0{hour}:00:00Z",
            values={"value": str(value)},
        )
    return str(table["code"])


async def accepted_run(
    context: AppContext, code: str, graph: dict[str, object]
) -> str:
    pipeline = await create_pipeline(context.client, code, graph)
    response = await context.client.post(
        f"{PIPELINES}/{pipeline['id']}:run",
        json={"trigger": "manual", "is_keeping_frames": True},
    )
    assert response.status_code == 202, response.text
    return str(data_of(response)["id"])


async def node_detail(
    context: AppContext, run_id: str, node_id: str
) -> dict[str, object]:
    response = await context.client.get(f"{RUNS}/{run_id}/nodes/{node_id}")
    assert response.status_code == 200, response.text
    return data_of(response)


def ledger_graph(left: str, right: str) -> dict[str, object]:
    common = {
        "columns": ["value"],
        "row_source": "manual",
        "since": "2026-01-01T00:00:00Z",
        "until": "2026-01-03T00:00:00Z",
    }
    return {
        "format_version": "1.0",
        "nodes": [
            node("left", "ledger_source", **common, table_code=left),
            node(
                "right",
                "ledger_source",
                **common,
                table_code=right,
                row_limit=1,
            ),
            node(
                "join",
                "ledger_join",
                how="left",
                tolerance_ms=0,
                right_prefix="right_",
            ),
        ],
        "edges": [
            edge("left-join", "left", "frame", "join", "left"),
            edge("right-join", "right", "frame", "join", "right"),
        ],
    }


async def test_ledger_join_persists_right_truncation_and_full_csv(
    app_context: AppContext,
) -> None:
    left = await seed_pair(app_context, "verify_left", (1, 2))
    right = await seed_pair(app_context, "verify_right", (10, 20))
    graph = ledger_graph(left, right)
    run_id = await accepted_run(app_context, "verify-ledger-join", graph)
    await drive_run(
        app_context.sessions, uuid.UUID(run_id), app_context.object_store
    )
    run = data_of(await app_context.client.get(f"{RUNS}/{run_id}"))
    assert run["status"] == "succeeded", run
    assert run["is_source_truncated"] is True
    detail = await node_detail(app_context, run_id, "join")
    preview = detail["preview"]["frame"]
    assert preview["head"] == [[1.0, None], [2.0, 20.0]]
    assert preview["provenance"]["table_codes"] == [left, right]
    assert preview["provenance"]["is_truncated"] is True
    assert detail["exported_ports"] == ["frame"]
    response = await app_context.client.get(
        f"{RUNS}/{run_id}/frames/join", params={"port": "frame"}
    )
    assert response.status_code == 200, response.text
    exported = list(csv.DictReader(io.StringIO(response.text)))
    assert len(exported) == 2
    assert exported[0]["right_value"] == ""
    assert float(exported[1]["right_value"]) == 20.0


def mock_bdm(
    kind: str, requests: list[dict[str, object]]
) -> Callable[[httpx.Request], httpx.Response]:
    identifier_field = {
        "point": "pointId",
        "raw": "propertyId",
        "formula": "code",
    }[kind]
    request_field = {
        "point": "pointIds",
        "raw": "propertyIds",
        "formula": "codes",
    }[kind]
    timestamp = "2026-10-25" if kind == "formula" else "2026-10-25 00:00:00"

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        assert body[request_field] == ["p1"]
        return success(
            {
                "kind": kind,
                "series": [
                    {
                        identifier_field: "p1",
                        "name": "真实业务标识",
                        "samples": [{"ct": timestamp, "value": 12.5}],
                    }
                ],
            }
        )

    return respond


def bdm_graph(kind: str) -> dict[str, object]:
    return {
        "format_version": "1.0",
        "nodes": [
            node(
                "source",
                "bdm_source",
                kind=kind,
                identifiers=["p1"],
                since="2026-10-24T16:00:00Z",
                until="2026-10-25T16:00:00Z",
            ),
            node("select", "select_columns", columns=["p1"]),
        ],
        "edges": [edge("source-select", "source", "frame", "select", "frame")],
    }


@pytest.mark.parametrize("kind", ["point", "raw", "formula"])
async def test_bdm_kinds_execute_through_worker_and_persist_real_values(
    app_context: AppContext,
    monkeypatch: pytest.MonkeyPatch,
    assembly_pool: NodePool,
    kind: str,
) -> None:
    requests: list[dict[str, object]] = []
    install_transport(monkeypatch, mock_bdm(kind, requests))
    graph = bdm_graph(kind)
    run_id = await accepted_run(app_context, f"verify-bdm-{kind}", graph)
    report = await execute_run(
        app_context.sessions,
        run_id=uuid.UUID(run_id),
        options=DispatchOptions(
            runner=DirectRunner(),
            tz_offset_minutes=480,
            store=app_context.object_store,
            bdm_connection=connection(),
            pool=assembly_pool,
        ),
    )
    assert report.status == "succeeded"
    assert len(requests) == 1
    detail = await node_detail(app_context, run_id, "source")
    frame = detail["preview"]["frame"]
    assert frame["head"] == [[12.5]]
    assert frame["index_head"] == [1792857600000]
    assert detail["report"]["blocks"]
    assert "api_key" not in json.dumps(detail)


async def test_prediction_and_all_diagnostic_branches_persist_computed_results(
    app_context: AppContext,
) -> None:
    await _seed_ledger(
        app_context.client, app_context.session, "verify_diagnostics"
    )
    graph = linear_graph("verify_diagnostics")
    graph["nodes"].extend(
        [
            node("residual", "residual_analysis"),
            node("importance", "feature_importance"),
            node("validation", "cross_validate", folds=3),
        ]
    )
    graph["edges"].extend(
        [
            edge("m-residual", "m", "scored", "residual", "scored"),
            edge("m-importance", "m", "model", "importance", "model"),
            edge("p-importance", "p", "test", "importance", "test"),
            edge("m-validation", "m", "model", "validation", "model"),
            edge("p-validation", "p", "train", "validation", "frame"),
        ]
    )
    run_id = await accepted_run(app_context, "verify-diagnostics", graph)
    await drive_run(
        app_context.sessions, uuid.UUID(run_id), app_context.object_store
    )
    run = data_of(await app_context.client.get(f"{RUNS}/{run_id}"))
    assert run["status"] == "succeeded", run
    for node_id in ("e", "residual", "importance", "validation"):
        detail = await node_detail(app_context, run_id, node_id)
        assert detail["status"] == "succeeded"
        assert detail["preview"]["metrics"]["kind"] == "metrics"
        assert detail["report"]["blocks"]
    residual = await node_detail(app_context, run_id, "residual")
    assert (
        abs(residual["preview"]["metrics"]["metrics"]["residual_mean"]) < 1e-8
    )
    validation = await node_detail(app_context, run_id, "validation")
    metrics = validation["preview"]["metrics"]["metrics"]
    assert metrics["folds"] == 2
    assert metrics["score_mean"] == pytest.approx(1.0)
