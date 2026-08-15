"""复制、导出与导入：包里不带 id，导入不静默丢绑定。

⚠ 带 id 的导出包一旦导回同一个库，「导入」就成了悄悄改掉源屏；而指向本部署
没有的点位的绑定必须照常入库并逐条报出来，静默丢掉会让人以为屏是能用的。
"""

import uuid
from typing import Any

import httpx
import pytest
from conftest import SEEDED_SOURCE_ID, SignHeaders

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    HTTP_BAD_REQUEST,
    HTTP_CONFLICT,
    HTTP_CREATED,
    HTTP_NOT_FOUND,
    data_of,
    make_dashboard,
    make_project,
)
from platform_server.apps.dashboard.catalog import (
    DASHBOARD_EDIT,
    DASHBOARD_VIEW,
)

pytestmark = pytest.mark.requires_postgres

HTTP_OK = 200
HTTP_FORBIDDEN = 403
KNOWN_KEY = f"{SEEDED_SOURCE_ID}:outlet_temp"
MISSING_KEY = f"{SEEDED_SOURCE_ID}:nowhere"
MISSING_ID = "00000000-0000-7000-8000-000000000000"
IMPORT_URL = f"{DASHBOARDS_URL}:import"


def id_keys(payload: object, prefix: str = "") -> list[str]:
    """载荷里全部名字带 id 的键路径。

    Args: payload, prefix。
    """
    found: list[str] = []
    if isinstance(payload, dict):
        for key, value in payload.items():
            path = f"{prefix}{key}"
            if key == "id" or str(key).endswith("_id"):
                found.append(path)
            found.extend(id_keys(value, f"{path}."))
    elif isinstance(payload, list):
        for index, item in enumerate(payload):
            found.extend(id_keys(item, f"{prefix}[{index}]."))
    return found


async def make_screen(client: httpx.AsyncClient) -> dict[str, Any]:
    """建一个项目加一张空大屏。

    Args: client。
    """
    project_id = await make_project(client)
    return await make_dashboard(client, project_id=project_id)


async def fill_screen(client: httpx.AsyncClient, dashboard_id: str) -> None:
    """放上「页头 + 挂实时绑定的孪生视图」这棵最小的树。

    ⚠ 子节点刻意不给 `client_key`：导出侧补键那条路必须被走到。
    Args: client, dashboard_id。
    """
    parent_id = str(uuid.uuid4())
    await client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}:replace-layout",
        json={
            "expected_version": 1,
            "nodes": [
                {
                    "id": parent_id,
                    "module_type": "header",
                    "client_key": "top",
                    "x": 0,
                    "y": 0,
                    "w": 1920,
                    "h": 96,
                    "bindings": [],
                },
                {
                    "module_type": "twin-view",
                    "parent_id": parent_id,
                    "x": 10,
                    "y": 20,
                    "w": 400,
                    "h": 300,
                    "bindings": [
                        {
                            "field_key": "anchorValues[0].value",
                            "source_kind": "opcua",
                            "node_key": KNOWN_KEY,
                        }
                    ],
                },
            ],
        },
    )


async def export_of(
    client: httpx.AsyncClient, dashboard_id: str
) -> dict[str, Any]:
    """导出一张大屏并回它的包。

    Args: client, dashboard_id。
    """
    response = await client.post(f"{DASHBOARDS_URL}/{dashboard_id}:export")
    assert response.status_code == HTTP_OK
    return data_of(response)


async def filled_screen(client: httpx.AsyncClient) -> dict[str, Any]:
    """建一张放好树的大屏并回它的形态。

    Args: client。
    """
    dashboard = await make_screen(client)
    await fill_screen(client, str(dashboard["id"]))
    return dashboard


async def import_package(
    client: httpx.AsyncClient, body: dict[str, Any]
) -> httpx.Response:
    """发一次导入。

    Args: client, body。
    """
    return await client.post(IMPORT_URL, json=body)


async def test_an_exported_package_carries_no_identifiers(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    assert id_keys(package) == []


async def test_a_node_without_a_client_key_gets_one_in_the_package(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    assert all(node["client_key"] for node in package["nodes"])


async def test_exporting_the_same_screen_twice_gives_the_same_package(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    first = await export_of(app_client, str(dashboard["id"]))
    assert first == await export_of(app_client, str(dashboard["id"]))


async def test_the_package_expresses_the_tree_with_parent_keys(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    keys = {node["client_key"] for node in package["nodes"]}
    parents = {node["parent_key"] for node in package["nodes"]} - {None}
    assert len(parents) == 1
    assert parents <= keys


async def test_the_package_carries_the_geometry_under_the_short_names(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    child = next(
        node for node in package["nodes"] if node["module_type"] == "twin-view"
    )
    assert (child["x"], child["y"], child["w"], child["h"]) == (
        10,
        20,
        400,
        300,
    )


async def test_exporting_a_dashboard_that_is_not_there_is_a_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(f"{DASHBOARDS_URL}/{MISSING_ID}:export")
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == 41002


async def test_a_viewer_may_export_because_nothing_changes(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    dashboard = await make_screen(app_client)
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:export",
        headers=sign([DASHBOARD_VIEW]),
    )
    assert response.status_code == HTTP_OK


async def test_a_copy_lands_in_the_source_project_with_a_suffixed_name(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:duplicate", json={}
    )
    assert response.status_code == HTTP_CREATED
    copied = data_of(response)
    assert copied["project_id"] == dashboard["project_id"]
    assert copied["name"] == f"{dashboard['name']} 副本"


async def test_a_copy_gets_its_own_identifiers(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    source = await app_client.get(f"{DASHBOARDS_URL}/{dashboard['id']}")
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:duplicate", json={}
    )
    copied = data_of(response)
    original = {node["id"] for node in data_of(source)["nodes"]}
    assert copied["id"] != dashboard["id"]
    assert {node["id"] for node in copied["nodes"]}.isdisjoint(original)


async def test_a_copy_carries_the_whole_tree_and_its_bindings(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:duplicate", json={}
    )
    copied = data_of(response)
    slots = [
        binding["field_key"]
        for node in copied["nodes"]
        for binding in node["bindings"]
    ]
    assert len(copied["nodes"]) == 2
    assert slots == ["anchorValues[0].value"]


async def test_copying_leaves_the_source_screen_untouched(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    before = await export_of(app_client, str(dashboard["id"]))
    await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:duplicate", json={}
    )
    assert await export_of(app_client, str(dashboard["id"])) == before


async def test_a_copy_can_be_renamed_and_sent_to_another_project(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    elsewhere = await make_project(app_client, name="储能")
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:duplicate",
        json={"new_name": "备份屏", "target_project_id": elsewhere},
    )
    copied = data_of(response)
    assert (copied["name"], copied["project_id"]) == ("备份屏", elsewhere)


async def test_copying_a_dashboard_that_is_not_there_is_a_404(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{MISSING_ID}:duplicate", json={}
    )
    assert response.status_code == HTTP_NOT_FOUND


async def test_an_editor_cannot_copy_a_dashboard(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    dashboard = await make_screen(app_client)
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:duplicate",
        json={},
        headers=sign([DASHBOARD_VIEW, DASHBOARD_EDIT]),
    )
    assert response.status_code == HTTP_FORBIDDEN


async def test_replaying_one_idempotency_key_makes_a_single_copy(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    headers = {"Idempotency-Key": "copy-once"}
    first = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:duplicate",
        json={},
        headers=headers,
    )
    second = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:duplicate",
        json={},
        headers=headers,
    )
    assert data_of(second)["id"] == data_of(first)["id"]


async def test_importing_creates_a_dashboard_in_the_named_project(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    elsewhere = await make_project(app_client, name="储能")
    response = await import_package(
        app_client, {"project_id": elsewhere, "payload": package}
    )
    imported = data_of(response)
    assert response.status_code == HTTP_OK
    assert imported["project_id"] == elsewhere
    assert len(imported["nodes"]) == 2


async def test_an_imported_dashboard_can_be_named_on_the_way_in(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    response = await import_package(
        app_client,
        {
            "project_id": dashboard["project_id"],
            "payload": package,
            "new_name": "导入屏",
        },
    )
    assert data_of(response)["name"] == "导入屏"


async def test_importing_over_a_target_keeps_its_identity_and_name(
    app_client: httpx.AsyncClient,
) -> None:
    source = await filled_screen(app_client)
    package = await export_of(app_client, str(source["id"]))
    target = await make_dashboard(
        app_client, project_id=str(source["project_id"]), name="旧屏"
    )
    response = await import_package(
        app_client,
        {
            "project_id": source["project_id"],
            "payload": package,
            "target_dashboard_id": target["id"],
        },
    )
    overwritten = data_of(response)
    assert (overwritten["id"], overwritten["name"]) == (target["id"], "旧屏")
    assert len(overwritten["nodes"]) == 2


async def test_overwriting_advances_the_row_version(
    app_client: httpx.AsyncClient,
) -> None:
    # 不推进版本，编辑器手上那份 expected_version 就还能覆盖掉这次导入
    source = await filled_screen(app_client)
    package = await export_of(app_client, str(source["id"]))
    target = await make_dashboard(
        app_client, project_id=str(source["project_id"]), name="旧屏"
    )
    response = await import_package(
        app_client,
        {
            "project_id": source["project_id"],
            "payload": package,
            "target_dashboard_id": target["id"],
        },
    )
    assert data_of(response)["row_version"] > target["row_version"]


async def test_overwriting_drops_the_nodes_the_target_used_to_have(
    app_client: httpx.AsyncClient,
) -> None:
    source = await filled_screen(app_client)
    package = await export_of(app_client, str(source["id"]))
    target = await filled_screen(app_client)
    await import_package(
        app_client,
        {
            "project_id": target["project_id"],
            "payload": package,
            "target_dashboard_id": target["id"],
        },
    )
    after = await app_client.get(f"{DASHBOARDS_URL}/{target['id']}")
    assert len(data_of(after)["nodes"]) == 2


async def test_overwriting_a_target_in_another_project_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    source = await filled_screen(app_client)
    package = await export_of(app_client, str(source["id"]))
    elsewhere = await make_project(app_client, name="储能")
    response = await import_package(
        app_client,
        {
            "project_id": elsewhere,
            "payload": package,
            "target_dashboard_id": source["id"],
        },
    )
    assert response.status_code == HTTP_CONFLICT
    assert response.json()["code"] == 41014


async def test_importing_into_a_project_that_is_not_there_is_a_404(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    response = await import_package(
        app_client, {"project_id": MISSING_ID, "payload": package}
    )
    assert response.status_code == HTTP_NOT_FOUND
    assert response.json()["code"] == 41001


async def test_a_parent_key_that_is_not_in_the_package_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    package["nodes"][0]["parent_key"] = "nowhere"
    response = await import_package(
        app_client, {"project_id": dashboard["project_id"], "payload": package}
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert response.json()["code"] == 41013


async def test_two_nodes_claiming_one_client_key_are_refused(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    package["nodes"][1]["client_key"] = package["nodes"][0]["client_key"]
    response = await import_package(
        app_client, {"project_id": dashboard["project_id"], "payload": package}
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert response.json()["code"] == 41013


async def test_an_unregistered_module_type_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    package["nodes"][0]["module_type"] = "gauge-chart"
    response = await import_package(
        app_client, {"project_id": dashboard["project_id"], "payload": package}
    )
    assert response.status_code == HTTP_BAD_REQUEST
    assert response.json()["code"] == 41010


async def test_a_refused_import_leaves_no_dashboard_behind(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    package["nodes"][0]["module_type"] = "gauge-chart"
    await import_package(
        app_client, {"project_id": dashboard["project_id"], "payload": package}
    )
    listed = await app_client.get(
        DASHBOARDS_URL, params={"project_id": dashboard["project_id"]}
    )
    assert listed.json()["data"]["total"] == 1


async def test_a_binding_to_a_missing_point_is_reported_not_dropped(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    package["nodes"][1]["bindings"][0]["node_key"] = MISSING_KEY
    response = await import_package(
        app_client, {"project_id": dashboard["project_id"], "payload": package}
    )
    assert response.status_code == HTTP_OK
    assert data_of(response)["unresolved_bindings"] == [
        {
            "node_key": MISSING_KEY,
            "field_key": "anchorValues[0].value",
            "source_kind": "opcua",
            "reason": "point_not_found",
        }
    ]


async def test_a_reported_binding_is_still_written_to_the_dashboard(
    app_client: httpx.AsyncClient,
) -> None:
    # 静默丢绑定会让用户以为导进来了一张能用的屏
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    package["nodes"][1]["bindings"][0]["node_key"] = MISSING_KEY
    response = await import_package(
        app_client, {"project_id": dashboard["project_id"], "payload": package}
    )
    stored = [
        binding["node_key"]
        for node in data_of(response)["nodes"]
        for binding in node["bindings"]
    ]
    assert stored == [MISSING_KEY]


async def test_a_resolvable_package_reports_nothing_unresolved(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    response = await import_package(
        app_client, {"project_id": dashboard["project_id"], "payload": package}
    )
    assert data_of(response)["unresolved_bindings"] == []


async def test_an_editor_cannot_import(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    response = await app_client.post(
        IMPORT_URL,
        json={"project_id": dashboard["project_id"], "payload": package},
        headers=sign([DASHBOARD_VIEW, DASHBOARD_EDIT]),
    )
    assert response.status_code == HTTP_FORBIDDEN


async def test_replaying_one_import_key_makes_a_single_dashboard(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    body = {"project_id": dashboard["project_id"], "payload": package}
    headers = {"Idempotency-Key": "import-once"}
    first = await app_client.post(IMPORT_URL, json=body, headers=headers)
    second = await app_client.post(IMPORT_URL, json=body, headers=headers)
    assert data_of(second)["id"] == data_of(first)["id"]


async def test_a_package_survives_export_import_export(
    app_client: httpx.AsyncClient,
) -> None:
    dashboard = await filled_screen(app_client)
    package = await export_of(app_client, str(dashboard["id"]))
    response = await import_package(
        app_client, {"project_id": dashboard["project_id"], "payload": package}
    )
    again = await export_of(app_client, str(data_of(response)["id"]))
    assert again == package
