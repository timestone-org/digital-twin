"""绑定面：id 稳定、一个槽只绑一次、来源与点位写错一律指到字段。

⚠ 绑定 id 是实时推送的关联键，任何一次更新都不许换它。
"""

import uuid
from typing import Any

import httpx
import pytest
from conftest import SEEDED_SOURCE_ID

from integration.dashboard_helpers import (
    BINDINGS_URL,
    DASHBOARDS_URL,
    HTTP_BAD_REQUEST,
    HTTP_CONFLICT,
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    NODES_URL,
    data_of,
    issue_fields,
    make_dashboard,
    make_node,
    make_project,
    node_body,
)

pytestmark = pytest.mark.requires_postgres

KNOWN_KEY = f"{SEEDED_SOURCE_ID}:outlet_temp"
OTHER_KEY = f"{SEEDED_SOURCE_ID}:inlet_temp"


async def make_twin_node(client: httpx.AsyncClient) -> str:
    """建一张大屏并放一个孪生节点，回节点 id。

    Args: client。
    """
    project_id = await make_project(client)
    dashboard = await make_dashboard(client, project_id=project_id)
    node = await make_node(
        client,
        dashboard_id=dashboard["id"],
        body=node_body(module_type="twin-view"),
    )
    return str(node["id"])


async def bind(
    client: httpx.AsyncClient, node_id: str, body: dict[str, Any]
) -> httpx.Response:
    """往一个节点上加一条绑定。

    Args: client, node_id, body。
    """
    return await client.post(f"{NODES_URL}/{node_id}/bindings", json=body)


async def test_a_realtime_binding_on_a_known_point_is_created(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    response = await bind(
        app_client,
        node_id,
        {
            "field_key": "scene_status",
            "source_kind": "opcua",
            "node_key": KNOWN_KEY,
        },
    )
    assert response.status_code == HTTP_CREATED
    assert data_of(response)["node_key"] == KNOWN_KEY


async def test_a_binding_on_a_point_nobody_collects_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    response = await bind(
        app_client,
        node_id,
        {
            "field_key": "scene_status",
            "source_kind": "opcua",
            "node_key": f"{SEEDED_SOURCE_ID}:nowhere",
        },
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert issue_fields(response) == [("node_key", "point_not_found")]


async def test_the_point_error_carries_the_source_domain_code(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    response = await bind(
        app_client,
        node_id,
        {
            "field_key": "scene_status",
            "source_kind": "opcua",
            "node_key": f"{SEEDED_SOURCE_ID}:nowhere",
        },
    )
    assert response.json()["code"] == 41011


async def test_a_misspelled_source_kind_never_reaches_the_table(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    response = await bind(
        app_client,
        node_id,
        {"field_key": "scene_status", "source_kind": "opuca"},
    )
    assert response.status_code == HTTP_BAD_REQUEST


async def test_a_slot_the_module_never_declared_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    response = await bind(
        app_client,
        node_id,
        {"field_key": "title", "source_kind": "static", "static_value_json": 1},
    )
    assert issue_fields(response) == [("field_key", "field_key_unknown")]


async def test_binding_one_slot_twice_conflicts(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    body = {
        "field_key": "scene_status",
        "source_kind": "static",
        "static_value_json": "运行",
    }
    await bind(app_client, node_id, body)
    response = await bind(app_client, node_id, body)
    assert response.status_code == HTTP_CONFLICT
    assert response.json()["code"] == 41006


async def test_an_array_slot_must_start_at_zero(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    response = await bind(
        app_client,
        node_id,
        {
            "field_key": "hotspots[3].value",
            "source_kind": "opcua",
            "node_key": KNOWN_KEY,
        },
    )
    assert issue_fields(response) == [("field_key", "array_index_gap")]


async def test_a_contiguous_array_run_is_accepted(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    first = await bind(
        app_client,
        node_id,
        {
            "field_key": "hotspots[0].value",
            "source_kind": "opcua",
            "node_key": KNOWN_KEY,
        },
    )
    second = await bind(
        app_client,
        node_id,
        {
            "field_key": "hotspots[1].value",
            "source_kind": "opcua",
            "node_key": OTHER_KEY,
        },
    )
    assert (first.status_code, second.status_code) == (
        HTTP_CREATED,
        HTTP_CREATED,
    )


async def test_an_update_keeps_the_binding_id(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    created = await bind(
        app_client,
        node_id,
        {
            "field_key": "scene_status",
            "source_kind": "opcua",
            "node_key": KNOWN_KEY,
        },
    )
    binding_id = data_of(created)["id"]
    response = await app_client.patch(
        f"{BINDINGS_URL}/{binding_id}", json={"node_key": OTHER_KEY}
    )
    assert data_of(response)["id"] == binding_id
    assert data_of(response)["node_key"] == OTHER_KEY


async def test_an_update_onto_a_point_nobody_collects_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    created = await bind(
        app_client,
        node_id,
        {
            "field_key": "scene_status",
            "source_kind": "opcua",
            "node_key": KNOWN_KEY,
        },
    )
    response = await app_client.patch(
        f"{BINDINGS_URL}/{data_of(created)['id']}",
        json={"node_key": f"{SEEDED_SOURCE_ID}:nowhere"},
    )
    assert issue_fields(response) == [("node_key", "point_not_found")]


async def test_the_binding_listing_is_ordered_by_slot(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    await bind(
        app_client,
        node_id,
        {
            "field_key": "scene_status",
            "source_kind": "static",
            "static_value_json": "运行",
        },
    )
    await bind(
        app_client,
        node_id,
        {
            "field_key": "hotspots[0].value",
            "source_kind": "opcua",
            "node_key": KNOWN_KEY,
        },
    )
    response = await app_client.get(BINDINGS_URL, params={"node_id": node_id})
    keys = [item["field_key"] for item in response.json()["data"]]
    assert keys == ["hotspots[0].value", "scene_status"]


async def test_a_deleted_binding_is_gone(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    created = await bind(
        app_client,
        node_id,
        {
            "field_key": "scene_status",
            "source_kind": "static",
            "static_value_json": 1,
        },
    )
    deleted = await app_client.delete(
        f"{BINDINGS_URL}/{data_of(created)['id']}"
    )
    assert deleted.status_code == HTTP_NO_CONTENT
    response = await app_client.get(BINDINGS_URL, params={"node_id": node_id})
    assert response.json()["data"] == []


async def test_a_missing_binding_answers_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.patch(
        f"{BINDINGS_URL}/{uuid.uuid4()}", json={"node_key": KNOWN_KEY}
    )
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == 41004


async def test_bindings_under_a_missing_node_answer_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await bind(
        app_client,
        str(uuid.uuid4()),
        {
            "field_key": "scene_status",
            "source_kind": "static",
            "static_value_json": 1,
        },
    )
    assert response.status_code == HTTP_NOT_FOUND


async def test_changing_a_module_type_reports_the_slots_it_orphans(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    node = await make_node(
        app_client,
        dashboard_id=dashboard["id"],
        body=node_body(module_type="twin-view"),
    )
    await bind(
        app_client,
        str(node["id"]),
        {
            "field_key": "scene_status",
            "source_kind": "static",
            "static_value_json": 1,
        },
    )
    response = await app_client.patch(
        f"{NODES_URL}/{node['id']}", json={"module_type": "header"}
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert [code for _field, code in issue_fields(response)] == [
        "field_key_unknown"
    ]


async def test_a_derived_binding_needs_a_registered_operator(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    response = await bind(
        app_client,
        node_id,
        {
            "field_key": "scene_status",
            "source_kind": "computed",
            "compute_json": {"op": "median", "inputs": ["a"]},
        },
    )
    assert issue_fields(response) == [("compute_json", "compute_spec_invalid")]


async def test_the_same_idempotency_key_creates_one_binding(
    app_client: httpx.AsyncClient,
) -> None:
    node_id = await make_twin_node(app_client)
    body = {
        "field_key": "scene_status",
        "source_kind": "static",
        "static_value_json": 1,
    }
    headers = {"Idempotency-Key": "binding-once"}
    first = await app_client.post(
        f"{NODES_URL}/{node_id}/bindings", json=body, headers=headers
    )
    second = await app_client.post(
        f"{NODES_URL}/{node_id}/bindings", json=body, headers=headers
    )
    assert data_of(first)["id"] == data_of(second)["id"]


async def test_adding_a_binding_advances_the_dashboard_version(
    app_client: httpx.AsyncClient,
) -> None:
    project_id = await make_project(app_client)
    dashboard = await make_dashboard(app_client, project_id=project_id)
    node = await make_node(
        app_client,
        dashboard_id=dashboard["id"],
        body=node_body(module_type="twin-view"),
    )
    await bind(
        app_client,
        str(node["id"]),
        {
            "field_key": "scene_status",
            "source_kind": "static",
            "static_value_json": 1,
        },
    )
    response = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    assert data_of(response)["row_version"] == 3
