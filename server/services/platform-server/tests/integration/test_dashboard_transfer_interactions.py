"""复制、导入和模板实例化都将联动引用绑定到本次创建的节点。"""

import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from conftest import AppContext
from sqlalchemy import update

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    data_of,
    make_dashboard,
    make_node,
    make_project,
    node_body,
)
from integration.test_dashboard_transfer_api import export_of, import_package
from platform_server.apps.dashboard.models import DashboardTemplate

pytestmark = pytest.mark.requires_postgres
TEMPLATES = "/api/v1/platform/dashboard-templates"


@dataclass(frozen=True)
class Source:
    project: str
    screen: str
    control: str
    panel: str
    external: str


def chrome(control: object, panel: object, external: str) -> dict[str, Any]:
    actions = [
        {"type": "toggle", "targets": [panel]},
        {"type": "show", "targets": [control, panel]},
        {"type": "hide", "targets": [panel]},
        {
            "type": "setActive",
            "groups": [
                {"value": external, "targets": [panel]},
                {"value": "b", "targets": [control]},
            ],
        },
        {"type": "openModal", "target": panel, "title": external},
        {"type": "closeModal"},
        {"type": "navigate", "target": external},
        {
            "type": "navigateByValue",
            "routes": [{"value": "a", "target": external}],
        },
    ]
    return {
        "accent": external,
        "interactions": [
            {
                "id": f"r{i}",
                "source": {"nodeId": control, "event": "click"},
                "action": action,
            }
            for i, action in enumerate(actions)
        ],
    }


async def source_with_rules(client: httpx.AsyncClient) -> Source:
    project = await make_project(client, "联动项目")
    screen = await make_dashboard(
        client, project_id=project, name="有联动的源屏"
    )
    control = await make_node(
        client,
        dashboard_id=screen["id"],
        body=node_body(module_type="action-button", client_key="control"),
    )
    panel = await make_node(
        client, dashboard_id=screen["id"], body=node_body(client_key="panel")
    )
    src = Source(
        project, screen["id"], control["id"], panel["id"], str(uuid.uuid4())
    )
    response = await client.patch(
        f"{DASHBOARDS_URL}/{src.screen}",
        json={"chrome_json": chrome(src.control, src.panel, src.external)},
    )
    assert response.is_success
    return src


def check_copy(data: dict[str, Any], source: Source) -> None:
    ids = {n["client_key"]: n["id"] for n in data["nodes"]}
    assert set(ids.values()).isdisjoint({source.control, source.panel})
    assert data["chrome_json"] == chrome(
        ids["control"], ids["panel"], source.external
    )


async def test_duplicating_a_dashboard_reconnects_every_local_interaction(
    app_client: httpx.AsyncClient,
) -> None:
    src = await source_with_rules(app_client)
    response = await app_client.post(
        f"{DASHBOARDS_URL}/{src.screen}:duplicate", json={}
    )
    assert response.status_code == 201
    check_copy(data_of(response), src)
    source = data_of(await app_client.get(f"{DASHBOARDS_URL}/{src.screen}"))
    assert source["chrome_json"] == chrome(src.control, src.panel, src.external)


async def test_new_package_keys_follow_new_nodes_across_projects(
    app_client: httpx.AsyncClient,
) -> None:
    src = await source_with_rules(app_client)
    package = await export_of(app_client, src.screen)
    package["chrome_json"] = chrome(
        {"client_key": "control"}, {"client_key": "panel"}, src.external
    )
    project = await make_project(app_client, "目标项目")
    response = await import_package(
        app_client, {"project_id": project, "payload": package}
    )
    assert response.status_code == 200
    check_copy(data_of(response), src)


async def test_legacy_choices_are_checked_before_an_overwrite(
    app_client: httpx.AsyncClient,
) -> None:
    src = await source_with_rules(app_client)
    package = await export_of(app_client, src.screen)
    package["chrome_json"] = chrome(src.control, src.panel, src.external)
    target = await make_dashboard(
        app_client, project_id=src.project, name="保留原内容"
    )
    old = await make_node(
        app_client, dashboard_id=target["id"], body=node_body(client_key="keep")
    )
    body = {
        "project_id": src.project,
        "target_dashboard_id": target["id"],
        "payload": package,
        "interaction_node_map": {src.control: "control", src.panel: "absent"},
    }
    refused = await import_package(app_client, body)
    assert refused.status_code == 400
    assert any(
        d["code"] == "interaction_node_key_unknown"
        for d in refused.json()["details"]
    )
    body["interaction_node_map"] = {
        src.control: "control",
        src.panel: "panel",
        "unused-choice": "control",
    }
    unused = await import_package(app_client, body)
    assert unused.status_code == 400
    assert (
        unused.json()["details"][0]["code"] == "interaction_node_choice_unused"
    )
    old_state = data_of(
        await app_client.get(f"{DASHBOARDS_URL}/{target['id']}")
    )
    assert [n["id"] for n in old_state["nodes"]] == [old["id"]]
    body["interaction_node_map"] = {src.control: "control", src.panel: "panel"}
    accepted = await import_package(app_client, body)
    assert accepted.status_code == 200
    check_copy(data_of(accepted), src)


async def test_a_stored_legacy_template_uses_confirmed_node_choices(
    app_context: AppContext,
) -> None:
    client = app_context.client
    src = await source_with_rules(client)
    response = await client.post(
        TEMPLATES, json={"source_dashboard_id": src.screen, "name": "旧版模板"}
    )
    assert response.status_code == 201
    template = data_of(response)
    package = await export_of(client, src.screen)
    package["chrome_json"] = chrome(src.control, src.panel, src.external)
    await app_context.session.execute(
        update(DashboardTemplate)
        .where(DashboardTemplate.id == uuid.UUID(template["id"]))
        .values(payload_json=package)
    )
    await app_context.session.commit()
    response = await client.post(
        f"{TEMPLATES}/{template['id']}:instantiate",
        json={
            "target_project_id": src.project,
            "interaction_node_map": {
                src.control: "control",
                src.panel: "panel",
            },
        },
    )
    assert response.status_code == 201
    check_copy(data_of(response), src)
