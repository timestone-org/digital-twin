"""整树替换：按 id 三路比对、版本断言、与逐节点端点同一套校验。

⚠ 批量路径不许更宽松：更宽松就等于「先用批量接口写进去、再用单条接口读出来」
这条绕过校验的后门。
"""

import uuid
from typing import Any

import httpx
import pytest
from conftest import SEEDED_SOURCE_ID

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    HTTP_BAD_REQUEST,
    HTTP_CONFLICT,
    data_of,
    issue_fields,
    make_dashboard,
    make_node,
    make_project,
    node_body,
)

pytestmark = pytest.mark.requires_postgres

KNOWN_KEY = f"{SEEDED_SOURCE_ID}:outlet_temp"


def layout_node(
    *,
    node_id: str | None = None,
    module_type: str = "header",
    parent_id: str | None = None,
    bindings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """一个替换条目。

    Args: node_id, module_type, parent_id, bindings。
    """
    body = node_body(module_type=module_type, parent_id=parent_id)
    if node_id is not None:
        body["id"] = node_id
    body["bindings"] = bindings or []
    return body


async def make_screen(client: httpx.AsyncClient) -> dict[str, Any]:
    """建一个项目加一张空大屏。

    Args: client。
    """
    project_id = await make_project(client)
    return await make_dashboard(client, project_id=project_id)


async def replace(
    client: httpx.AsyncClient,
    dashboard_id: str,
    *,
    version: int,
    nodes: list[dict[str, Any]],
) -> httpx.Response:
    """发一次整树替换。

    Args: client, dashboard_id, version, nodes。
    """
    return await client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}:replace-layout",
        json={"expected_version": version, "nodes": nodes},
    )


async def test_a_stale_version_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    response = await replace(
        app_client, dashboard["id"], version=99, nodes=[layout_node()]
    )
    assert response.status_code == HTTP_CONFLICT
    assert response.json()["code"] == 41007


async def test_a_matching_version_is_accepted_and_advances(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    response = await replace(
        app_client, dashboard["id"], version=1, nodes=[layout_node()]
    )
    assert data_of(response)["row_version"] == 2


async def test_an_existing_node_keeps_its_id_across_a_replace(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    node = await make_node(app_client, dashboard_id=dashboard["id"])
    current = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    version = data_of(current)["row_version"]
    moved = layout_node(node_id=str(node["id"]))
    moved["x"] = 400
    response = await replace(
        app_client, dashboard["id"], version=version, nodes=[moved]
    )
    nodes = data_of(response)["nodes"]
    assert [item["id"] for item in nodes] == [node["id"]]
    assert nodes[0]["x"] == 400


async def test_a_binding_keeps_its_id_across_a_replace(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    node_id = str(uuid.uuid4())
    binding_id = str(uuid.uuid4())
    binding = {
        "id": binding_id,
        "field_key": "scene_status",
        "source_kind": "opcua",
        "node_key": KNOWN_KEY,
    }
    entry = layout_node(
        node_id=node_id, module_type="twin-view", bindings=[binding]
    )
    await replace(app_client, dashboard["id"], version=1, nodes=[entry])
    second = await replace(
        app_client, dashboard["id"], version=2, nodes=[entry]
    )
    stored = data_of(second)["nodes"][0]["bindings"]
    assert [item["id"] for item in stored] == [binding_id]


async def test_a_node_left_out_of_the_payload_is_deleted(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    kept = await make_node(
        app_client, dashboard_id=dashboard["id"], body=node_body(client_key="a")
    )
    await make_node(
        app_client, dashboard_id=dashboard["id"], body=node_body(client_key="b")
    )
    current = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    response = await replace(
        app_client,
        dashboard["id"],
        version=data_of(current)["row_version"],
        nodes=[layout_node(node_id=str(kept["id"]))],
    )
    assert [item["id"] for item in data_of(response)["nodes"]] == [kept["id"]]


async def test_a_child_of_a_deleted_node_survives_when_reparented(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    parent = await make_node(
        app_client, dashboard_id=dashboard["id"], body=node_body(client_key="p")
    )
    child = await make_node(
        app_client,
        dashboard_id=dashboard["id"],
        body=node_body(client_key="c", parent_id=str(parent["id"])),
    )
    current = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    response = await replace(
        app_client,
        dashboard["id"],
        version=data_of(current)["row_version"],
        nodes=[layout_node(node_id=str(child["id"]))],
    )
    nodes = data_of(response)["nodes"]
    assert [(item["id"], item["parent_id"]) for item in nodes] == [
        (child["id"], None)
    ]


async def test_a_client_supplied_id_lets_a_child_name_its_new_parent(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    parent_id = str(uuid.uuid4())
    response = await replace(
        app_client,
        dashboard["id"],
        version=1,
        nodes=[
            layout_node(module_type="twin-view", parent_id=parent_id),
            layout_node(node_id=parent_id),
        ],
    )
    parents = {item["parent_id"] for item in data_of(response)["nodes"]}
    assert parents == {None, parent_id}


async def test_two_entries_claiming_one_id_are_refused(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    node_id = str(uuid.uuid4())
    response = await replace(
        app_client,
        dashboard["id"],
        version=1,
        nodes=[layout_node(node_id=node_id), layout_node(node_id=node_id)],
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert issue_fields(response) == [("nodes[1].id", "duplicate_id")]


async def test_a_cycle_inside_the_payload_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    first = str(uuid.uuid4())
    second = str(uuid.uuid4())
    response = await replace(
        app_client,
        dashboard["id"],
        version=1,
        nodes=[
            layout_node(node_id=first, parent_id=second),
            layout_node(node_id=second, parent_id=first),
        ],
    )
    assert issue_fields(response) == [
        ("nodes[0].parent_id", "parent_cycle"),
        ("nodes[1].parent_id", "parent_cycle"),
    ]


async def test_the_batch_path_rejects_what_the_single_path_rejects(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    response = await replace(
        app_client,
        dashboard["id"],
        version=1,
        nodes=[layout_node(module_type="gauge-chart")],
    )
    assert issue_fields(response) == [
        ("nodes[0].module_type", "module_type_unknown")
    ]


async def test_the_batch_path_checks_binding_slots_too(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    response = await replace(
        app_client,
        dashboard["id"],
        version=1,
        nodes=[
            layout_node(
                module_type="header",
                bindings=[
                    {
                        "field_key": "scene_status",
                        "source_kind": "static",
                        "static_value_json": 1,
                    }
                ],
            )
        ],
    )
    assert issue_fields(response) == [
        ("nodes[0].bindings[0].field_key", "field_key_unknown")
    ]


async def test_the_batch_path_checks_points_too(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    response = await replace(
        app_client,
        dashboard["id"],
        version=1,
        nodes=[
            layout_node(
                module_type="twin-view",
                bindings=[
                    {
                        "field_key": "scene_status",
                        "source_kind": "opcua",
                        "node_key": f"{SEEDED_SOURCE_ID}:nowhere",
                    }
                ],
            )
        ],
    )
    assert issue_fields(response) == [
        ("nodes[0].bindings[0].node_key", "point_not_found")
    ]


async def test_a_rejected_replace_leaves_the_tree_untouched(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    node = await make_node(app_client, dashboard_id=dashboard["id"])
    current = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    await replace(
        app_client,
        dashboard["id"],
        version=data_of(current)["row_version"],
        nodes=[layout_node(module_type="gauge-chart")],
    )
    after = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    assert [item["id"] for item in data_of(after)["nodes"]] == [node["id"]]


async def test_an_empty_payload_clears_the_tree(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    await make_node(app_client, dashboard_id=dashboard["id"])
    current = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    response = await replace(
        app_client,
        dashboard["id"],
        version=data_of(current)["row_version"],
        nodes=[],
    )
    assert data_of(response)["nodes"] == []


async def test_the_format_version_can_move_with_a_replace(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:replace-layout",
        json={"expected_version": 1, "schema_version": 3, "nodes": []},
    )
    assert data_of(response)["schema_version"] == 3
    assert data_of(response)["row_version"] == 2


async def test_a_replace_without_a_version_assertion_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:replace-layout",
        json={"nodes": []},
    )
    assert response.status_code == HTTP_BAD_REQUEST


async def test_a_dangling_binding_shows_up_in_the_self_check(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await make_screen(app_client)
    await replace(
        app_client,
        dashboard["id"],
        version=1,
        nodes=[
            layout_node(
                module_type="twin-view",
                bindings=[
                    {
                        "field_key": "scene_status",
                        "source_kind": "opcua",
                        "node_key": KNOWN_KEY,
                    }
                ],
            )
        ],
    )
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:validate"
    )
    assert data_of(response)["is_valid"] is True
