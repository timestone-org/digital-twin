"""发布计划的读侧打真库：只取实时绑定、按版本判断要不要重读。

⚠ `archive` 绑定也指向点位，但它要的是历史序列——被当成现值推出去，客户端会
把一条历史曲线的最后一点当作实时读数。
"""

import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    HTTP_CREATED,
    NODES_URL,
    data_of,
    make_dashboard,
    make_node,
    make_project,
    node_body,
)
from integration.dashboard_publish_fixtures import (
    ANOTHER_KEY,
    KNOWN_KEY,
    SessionDatabase,
    bind,
    make_twin_node,
)
from platform_server.apps.dashboard.crud import publish_crud
from platform_server.apps.dashboard.services.publish_plan import (
    DatabaseDashboardIndex,
    DatabasePlanSource,
)

pytestmark = pytest.mark.requires_postgres
HTTP_NO_CONTENT = 204


async def test_only_realtime_bindings_enter_the_plan(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    dashboard_id, node_id = await make_twin_node(app_client)
    await bind(app_client, node_id, "scene_status", "opcua", KNOWN_KEY)
    await bind(
        app_client,
        node_id,
        "hotspots[0].value",
        "archive",
        ANOTHER_KEY,
    )
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    lookup = await plans.load(uuid.UUID(dashboard_id), None)
    assert lookup.plan is not None
    assert lookup.plan.node_keys == (KNOWN_KEY,)


async def test_a_point_bound_twice_is_read_once(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    dashboard_id, node_id = await make_twin_node(app_client)
    await bind(app_client, node_id, "scene_status", "opcua", KNOWN_KEY)
    await bind(app_client, node_id, "hotspots[0].value", "opcua", KNOWN_KEY)
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    lookup = await plans.load(uuid.UUID(dashboard_id), None)
    assert lookup.plan is not None
    assert lookup.plan.node_keys == (KNOWN_KEY,)


async def test_another_dashboards_bindings_stay_out_of_the_plan(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    dashboard_id, node_id = await make_twin_node(app_client)
    await bind(app_client, node_id, "scene_status", "opcua", KNOWN_KEY)
    _other_id, other_node = await make_twin_node(app_client)
    await bind(app_client, other_node, "scene_status", "opcua", ANOTHER_KEY)
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    lookup = await plans.load(uuid.UUID(dashboard_id), None)
    assert lookup.plan is not None
    assert lookup.plan.node_keys == (KNOWN_KEY,)


async def test_an_unchanged_dashboard_is_not_read_again(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    dashboard_id, node_id = await make_twin_node(app_client)
    await bind(app_client, node_id, "scene_status", "opcua", KNOWN_KEY)
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    first = await plans.load(uuid.UUID(dashboard_id), None)
    second = await plans.load(uuid.UUID(dashboard_id), first.plan)
    assert second.is_reloaded is False
    assert second.plan is first.plan


async def test_a_new_binding_bumps_the_version_and_forces_a_reread(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    dashboard_id, node_id = await make_twin_node(app_client)
    await bind(app_client, node_id, "scene_status", "opcua", KNOWN_KEY)
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    first = await plans.load(uuid.UUID(dashboard_id), None)
    await bind(app_client, node_id, "hotspots[0].value", "opcua", ANOTHER_KEY)
    second = await plans.load(uuid.UUID(dashboard_id), first.plan)
    assert second.is_reloaded is True
    assert second.plan is not None
    assert second.plan.node_keys == tuple(sorted((KNOWN_KEY, ANOTHER_KEY)))


async def test_asking_for_no_dashboards_touches_no_row(
    db_session: AsyncSession,
) -> None:
    assert await publish_crud.versions_of(db_session, []) == {}


async def test_a_dashboard_that_no_longer_exists_has_no_plan(
    db_session: AsyncSession,
) -> None:
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    lookup = await plans.load(uuid.uuid4(), None)
    assert lookup.plan is None
    assert lookup.is_reloaded is False


async def test_a_dashboard_without_bindings_plans_no_points(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await make_project(app_client, name="空项目")
    dashboard = await make_dashboard(app_client, project_id=project_id)
    await make_node(app_client, dashboard_id=str(dashboard["id"]))
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    lookup = await plans.load(uuid.UUID(str(dashboard["id"])), None)
    assert lookup.plan is not None
    assert lookup.plan.node_keys == ()


async def test_every_dashboard_shows_up_in_the_index_topics_reconcile_with(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await make_project(app_client, name="对账项目")
    first = await make_dashboard(app_client, project_id=project_id, name="一")
    second = await make_dashboard(app_client, project_id=project_id, name="二")
    index = DatabaseDashboardIndex(database=SessionDatabase(db_session))
    live = await index.live_ids()
    assert uuid.UUID(str(first["id"])) in live
    assert uuid.UUID(str(second["id"])) in live


async def test_a_deleted_dashboard_leaves_the_index(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await make_project(app_client, name="删除项目")
    dashboard = await make_dashboard(app_client, project_id=project_id)
    response = await app_client.delete(f"{DASHBOARDS_URL}/{dashboard['id']}")
    assert response.status_code == HTTP_NO_CONTENT
    index = DatabaseDashboardIndex(database=SessionDatabase(db_session))
    assert uuid.UUID(str(dashboard["id"])) not in await index.live_ids()


async def test_a_node_under_another_node_still_contributes_its_points(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    dashboard_id, parent_id = await make_twin_node(app_client)
    child = await app_client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}/nodes",
        json=node_body(module_type="twin-view", parent_id=parent_id),
    )
    assert child.status_code == HTTP_CREATED
    child_id = str(data_of(child)["id"])
    await bind(app_client, child_id, "scene_status", "opcua", ANOTHER_KEY)
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    lookup = await plans.load(uuid.UUID(dashboard_id), None)
    assert lookup.plan is not None
    assert lookup.plan.node_keys == (ANOTHER_KEY,)
    assert NODES_URL.endswith("dashboard-nodes")
