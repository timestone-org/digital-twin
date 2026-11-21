"""冻结异常检测版本在三种推理入口都不自动填补观测缺失。"""

import json
from typing import Any
from uuid import UUID

import httpx
import pytest
from conftest import AppContext

from integration.dataset_helpers import (
    create_column,
    create_record,
    create_table,
)
from integration.modeling_helpers import create_pipeline, data_of
from integration.test_modeling_anomaly_api import FIXTURE, NORMAL, seed_normal
from integration.test_modeling_anomaly_models_api import bind_call_fakes
from integration.test_modeling_api import _run_pipeline
from integration.test_modeling_formula_seam import (
    BINDINGS,
    _library_entry,
    _publish,
)
from platform_server.apps.modeling.crud import model_version_crud

pytestmark = pytest.mark.requires_postgres
FIELDS = ("电流", "频率", "温度")
MISSING = {"电流": NORMAL["电流"], "频率": NORMAL["频率"]}


async def freeze_version(
    context: AppContext, *, has_fill: bool
) -> tuple[dict[str, Any], dict[str, Any]]:
    bind_call_fakes(context)
    client = context.client
    history = await seed_normal(client, context.session)
    graph = json.loads(FIXTURE.read_text())
    graph["nodes"][0]["operator"] = "ledger_source"
    graph["nodes"][0]["config"] = {
        "table_code": history,
        "columns": list(FIELDS),
        "row_source": "manual",
        "since": "2026-10-01T00:00:00Z",
        "until": "2026-10-02T00:00:00Z",
    }
    if has_fill:
        graph["nodes"][1]["operator"] = "fill_missing"
        graph["nodes"][1]["config"] = {
            "strategy": "median",
            "columns": ["温度"],
        }
        graph["nodes"] = [node for node in graph["nodes"] if node["id"] != "d"]
        graph["edges"] = [
            edge for edge in graph["edges"] if edge["from_node"] != "d"
        ]
        next(edge for edge in graph["edges"] if edge["from_node"] == "c")[
            "to_node"
        ] = "p"
    pipeline = await create_pipeline(client, "anomaly-policy-probe", graph)
    run = await _run_pipeline(client, context.sessions, pipeline["id"])
    assert run["status"] == "succeeded", run
    version = await _publish(client, run["id"], "合成异常模型")
    assert version["task"] == "anomaly_detection"
    assert version["target_key"] is None
    assert version["is_servable"]
    deployment = await client.post(
        "/api/v1/platform/modeling-deployments",
        json={
            "code": "anomaly-policy-probe",
            "name": "合成异常模型",
            "model_version_id": version["id"],
            "rate_limit_per_minute": 30,
        },
    )
    assert deployment.status_code == 201, deployment.text
    async with context.sessions.session() as session:
        stored = await model_version_crud.get(session, UUID(version["id"]))
        assert stored is not None
        return version, dict(stored.serving_json)


async def formula_cells(
    client: httpx.AsyncClient, version_id: str, rows: list[dict[str, object]]
) -> list[float | None]:
    code = "异常基线"
    await _library_entry(client, code, list(FIELDS))
    bound = await client.post(
        BINDINGS, json={"fx_code": code, "model_version_id": version_id}
    )
    assert bound.status_code == 201, bound.text
    table = await create_table(client, code="formula_anomaly")
    table_id = str(table["id"])
    for key in FIELDS:
        await create_column(client, table_id, key=key)
    arguments = ", ".join(f"{{{key}}}" for key in FIELDS)
    await create_column(
        client,
        table_id,
        key="分数",
        source="formula",
        formula=f"@{code}({arguments})",
    )
    results = []
    for index, row in enumerate(rows):
        saved = (
            await create_record(
                client, table_id, ts=f"2026-11-02T0{index}:00:00Z", values=row
            )
        )["record"]
        assert not saved["compute_error"]
        results.append(saved["computed"].get("分数"))
    return results


@pytest.mark.parametrize(
    "has_fill", [False, True], ids=["no-fill", "frozen-leading-fill"]
)
async def test_published_anomaly_does_not_fill_missing_observations(
    app_context: AppContext, has_fill: bool
) -> None:
    version, frozen = await freeze_version(app_context, has_fill=has_fill)
    fields = version["signature"]["inputs"]
    assert all(
        field["is_required"] and field["default_on_missing"] is None
        for field in fields
    )
    steps = frozen["steps"]
    fitted = steps[0]["fitted"] if has_fill else {}
    if has_fill:
        assert steps[0]["operator"] == "fill_missing"
        assert isinstance(fitted["温度"], (int, float))
    else:
        assert steps[0]["operator"] != "fill_missing"

    explicit = {**MISSING, "温度": fitted.get("温度", NORMAL["温度"])}
    zero = {**MISSING, "温度": 0}
    cases = [NORMAL, MISSING, {**MISSING, "温度": None}, explicit, zero]
    client = app_context.client
    path = "/api/v1/platform/open-models/anomaly-policy-probe"
    detects = [
        await client.post(path + ":detect", json={"rows": [row]})
        for row in cases
    ]
    assert [reply.status_code for reply in detects] == [200, 400, 400, 200, 200]
    generic = [
        await client.post(path + ":predict", json={"rows": [row]})
        for row in cases
    ]
    assert [reply.status_code for reply in generic] == [200, 400, 200, 200, 200]
    scores = [
        data_of(reply)["predictions"][0] if reply.status_code == 200 else None
        for reply in generic
    ]
    cells = await formula_cells(client, str(version["id"]), cases)
    assert scores[2] is None
    assert cells[1:3] == [None, None]
    for index in (0, 3, 4):
        detection_score = data_of(detects[index])["results"][0]["score"]
        assert scores[index] == pytest.approx(detection_score)
        assert cells[index] == pytest.approx(detection_score)
    assert scores[4] != pytest.approx(scores[3])
