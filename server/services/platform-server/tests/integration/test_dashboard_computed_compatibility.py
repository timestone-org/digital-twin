"""派生绑定的逐槽写入、整树保存与旧包导入。"""

from typing import Any

import httpx
import pytest

from integration.dashboard_helpers import (
    BINDINGS_URL,
    DASHBOARDS_URL,
    NODES_URL,
    data_of,
    issue_fields,
    make_dashboard,
    make_node,
    make_project,
    node_body,
)

pytestmark = pytest.mark.requires_postgres


def _computed(op: str, inputs: list[Any]) -> dict[str, Any]:
    return {
        "field_key": "cellValues[0].value",
        "source_kind": "computed",
        "compute_json": {"op": op, "inputs": inputs},
    }


@pytest.mark.parametrize(
    ("op", "inputs", "error"),
    [
        ("sum", ["cellValues[0].aux", 17], "compute_input_not_string"),
        ("sum", ["ghost"], "compute_input_slot_unknown"),
        ("ratio", ["cellValues[0].aux"], "compute_arity_invalid"),
        ("sum", [], "compute_arity_invalid"),
    ],
)
async def test_new_computation_must_have_usable_specification(
    app_client: httpx.AsyncClient, op: str, inputs: list[Any], error: str
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    node = await make_node(
        app_client,
        dashboard_id=dashboard["id"],
        body=node_body(module_type="data-card"),
    )
    response = await app_client.post(
        f"{NODES_URL}/{node['id']}/bindings", json=_computed(op, inputs)
    )
    assert response.status_code == 400
    assert [code for _, code in issue_fields(response)] == [error]


async def _import_computed(
    client: httpx.AsyncClient, inputs: list[Any]
) -> dict[str, Any]:
    project_id = await make_project(client)
    response = await client.post(
        f"{DASHBOARDS_URL}:import",
        json={
            "project_id": project_id,
            "payload": {
                "schema_version": 1,
                "name": "旧派生绑定",
                "design_width": 1920,
                "design_height": 1080,
                "nodes": [
                    {
                        **node_body(module_type="data-card", client_key="card"),
                        "bindings": [_computed("sum", inputs)],
                    },
                ],
            },
        },
    )
    assert response.status_code == 200
    return data_of(response)


def _save_body(
    dashboard: dict[str, Any], *, target: dict[str, Any] | None = None
) -> dict[str, Any]:
    node = dashboard["nodes"][0]
    binding = node["bindings"][0]
    keys = ("id", "parent_id", "client_key", "module_type", "x", "y", "w", "h")
    row = {key: node[key] for key in keys}
    row["x"] += 8
    original = {
        key: binding[key]
        for key in ("id", "field_key", "source_kind", "compute_json")
    }
    if target is not None:
        original["compute_json"] = target
    row["bindings"] = [original]
    return {"expected_version": dashboard["row_version"], "nodes": [row]}


async def test_legacy_computation_survives_import_and_unrelated_saves(
    app_client: httpx.AsyncClient,
) -> None:
    imported = await _import_computed(app_client, ["cellValues[0].aux", 17])
    warning = imported["computed_binding_warnings"][0]
    assert warning["module_type"] == "data-card"
    assert warning["node_client_key"] == "card"
    assert warning["field_key"] == "cellValues[0].value"
    assert warning["field"] == "compute_json.inputs[1]"
    assert warning["reason"] == "compute_input_not_string"
    assert warning["message"]
    assert imported["unresolved_bindings"] == []
    old = imported["nodes"][0]["bindings"][0]
    assert old["compute_json"] == {
        "op": "sum",
        "inputs": ["cellValues[0].aux", 17],
    }
    patched = await app_client.patch(
        f"{BINDINGS_URL}/{old['id']}", json={"transform_json": {"scale": 2}}
    )
    assert data_of(patched)["compute_json"] == old["compute_json"]
    dashboard_url = f"{DASHBOARDS_URL}/{imported['id']}"
    current = data_of(await app_client.get(dashboard_url))
    retained = await app_client.post(
        f"{dashboard_url}:replace-layout", json=_save_body(current)
    )
    assert retained.status_code == 200
    updated = data_of(retained)
    assert (
        updated["nodes"][0]["bindings"][0]["compute_json"]
        == old["compute_json"]
    )
    invalid = {"op": "sum", "inputs": ["ghost"]}
    rejected = await app_client.post(
        f"{dashboard_url}:replace-layout",
        json=_save_body(updated, target=invalid),
    )
    assert rejected.status_code == 400
    rejected = await app_client.patch(
        f"{BINDINGS_URL}/{old['id']}", json={"compute_json": invalid}
    )
    assert rejected.status_code == 400
    declared_unbound = {"op": "sum", "inputs": ["cellValues[0].aux2"]}
    repaired = await app_client.patch(
        f"{BINDINGS_URL}/{old['id']}", json={"compute_json": declared_unbound}
    )
    assert repaired.status_code == 200
    assert data_of(repaired)["compute_json"] == declared_unbound


async def test_empty_inputs_from_legacy_browser_export_are_preserved(
    app_client: httpx.AsyncClient,
) -> None:
    imported = await _import_computed(app_client, [])
    assert (
        imported["computed_binding_warnings"][0]["reason"]
        == "compute_arity_invalid"
    )
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{imported['id']}:replace-layout",
        json=_save_body(imported),
    )
    assert response.status_code == 200
    assert data_of(response)["nodes"][0]["bindings"][0]["compute_json"] == {
        "op": "sum",
        "inputs": [],
    }
