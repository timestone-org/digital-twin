"""大屏导入、导出与复制按选择保留点位绑定，且不修改源屏。"""

from copy import deepcopy
from typing import Any

import httpx
import pytest

from integration.dashboard_helpers import DASHBOARDS_URL, HTTP_CREATED, data_of
from integration.test_dashboard_transfer_api import (
    HTTP_OK,
    MISSING_KEY,
    export_of,
    filled_screen,
    import_package,
)

pytestmark = pytest.mark.requires_postgres


def mixed_bindings() -> list[dict[str, Any]]:
    """点位、历史、静态、台账与同节点计算的混合绑定。"""
    return [
        {
            "field_key": "anchorValues[0].value",
            "source_kind": "opcua",
            "node_key": MISSING_KEY,
        },
        {
            "field_key": "anchorValues[1].value",
            "source_kind": "archive",
            "detail_json": {"node_key": MISSING_KEY},
        },
        {
            "field_key": "anchorValues[2].value",
            "source_kind": "computed",
            "compute_json": {"op": "sum", "inputs": ["anchorValues[0].value"]},
        },
        {
            "field_key": "anchorValues[3].value",
            "source_kind": "computed",
            "compute_json": {"op": "sum", "inputs": ["anchorValues[2].value"]},
        },
        {
            "field_key": "anchorValues[4].value",
            "source_kind": "static",
            "static_value_json": 42,
        },
        {
            "field_key": "anchorValues[5].value",
            "source_kind": "computed",
            "compute_json": {"op": "sum", "inputs": ["anchorValues[4].value"]},
        },
        {
            "field_key": "anchorValues[6].value",
            "source_kind": "dataset",
            "detail_json": {"column_ref": "ds:energy:power"},
        },
    ]


@pytest.mark.parametrize(
    "should_include", [True, False], ids=["keep", "ignore"]
)
async def test_export_selects_point_bindings_without_changing_the_source(
    app_client: httpx.AsyncClient, should_include: bool
) -> None:
    dashboard = await filled_screen(app_client)
    before = await export_of(app_client, str(dashboard["id"]))
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:export",
        json={"include_point_bindings": should_include},
    )
    expected = deepcopy(before)
    if not should_include:
        for node in expected["nodes"]:
            node["bindings"] = []
    assert response.status_code == HTTP_OK
    assert data_of(response) == expected
    assert await export_of(app_client, str(dashboard["id"])) == before


@pytest.mark.parametrize(
    "should_include", [True, False], ids=["keep", "ignore"]
)
async def test_duplicate_selects_point_bindings_without_changing_the_source(
    app_client: httpx.AsyncClient, should_include: bool
) -> None:
    dashboard = await filled_screen(app_client)
    before = await export_of(app_client, str(dashboard["id"]))
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard['id']}:duplicate",
        json={"include_point_bindings": should_include},
    )
    assert response.status_code == HTTP_CREATED
    copied = await export_of(app_client, str(data_of(response)["id"]))
    expected = deepcopy(before)
    expected["name"] = f"{dashboard['name']} 副本"
    if not should_include:
        for node in expected["nodes"]:
            node["bindings"] = []
    assert copied == expected
    assert await export_of(app_client, str(dashboard["id"])) == before


@pytest.mark.parametrize(
    "should_overwrite", [False, True], ids=["create", "replace"]
)
async def test_import_can_ignore_missing_points_without_unresolved_warnings(
    app_client: httpx.AsyncClient, should_overwrite: bool
) -> None:
    source = await filled_screen(app_client)
    before = await export_of(app_client, str(source["id"]))
    package = deepcopy(before)
    package["nodes"][1]["bindings"][0]["node_key"] = MISSING_KEY
    body = {
        "project_id": source["project_id"],
        "payload": package,
        "include_point_bindings": False,
    }
    if should_overwrite:
        target = await filled_screen(app_client)
        body["project_id"] = target["project_id"]
        body["target_dashboard_id"] = target["id"]
    response = await import_package(app_client, body)
    assert response.status_code == HTTP_OK
    imported = data_of(response)
    assert imported["unresolved_bindings"] == []
    assert all(not node["bindings"] for node in imported["nodes"])
    assert await export_of(app_client, str(source["id"])) == before


async def test_import_ignores_points_and_their_dependent_computations_only(
    app_client: httpx.AsyncClient,
) -> None:
    source = await filled_screen(app_client)
    package = await export_of(app_client, str(source["id"]))
    package["nodes"][1]["bindings"] = mixed_bindings()
    response = await import_package(
        app_client,
        {
            "project_id": source["project_id"],
            "payload": package,
            "include_point_bindings": False,
        },
    )
    assert response.status_code == HTTP_OK
    child = next(
        node
        for node in data_of(response)["nodes"]
        if node["module_type"] == "twin-view"
    )
    assert [binding["field_key"] for binding in child["bindings"]] == [
        "anchorValues[4].value",
        "anchorValues[5].value",
        "anchorValues[6].value",
    ]
