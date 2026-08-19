"""发布计划的读侧打真库：只取实时绑定、按版本判断要不要重读。

⚠ `archive` 绑定也指向点位，但它要的是历史序列——被当成现值推出去，客户端会
把一条历史曲线的最后一点当作实时读数。
"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
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
    load_one,
    make_twin_node,
)
from platform_server.apps.dashboard.crud import publish_crud
from platform_server.apps.dashboard.services.publish_plan import (
    DatabaseDashboardIndex,
    DatabasePlanSource,
)

pytestmark = pytest.mark.requires_postgres
HTTP_NO_CONTENT = 204


@contextmanager
def counted_selects() -> Iterator[list[str]]:
    """收集这段时间里发出的全部 SELECT 语句。"""
    seen: list[str] = []

    def record(
        _connection: Any,
        _cursor: Any,
        statement: str,
        _parameters: Any,
        _context: Any,
        _is_executemany: object,
    ) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            seen.append(statement)

    event.listen(Engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(Engine, "before_cursor_execute", record)


async def test_only_realtime_bindings_enter_the_plan(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    dashboard_id, node_id = await make_twin_node(app_client)
    await bind(app_client, node_id, "anchorValues[0].value", "opcua", KNOWN_KEY)
    await bind(
        app_client,
        node_id,
        "anchorValues[1].value",
        "archive",
        ANOTHER_KEY,
    )
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    lookup = await load_one(plans, uuid.UUID(dashboard_id))
    assert lookup.plan is not None
    assert lookup.plan.node_keys == (KNOWN_KEY,)


async def test_a_point_bound_twice_is_read_once(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    dashboard_id, node_id = await make_twin_node(app_client)
    await bind(app_client, node_id, "anchorValues[0].value", "opcua", KNOWN_KEY)
    await bind(app_client, node_id, "anchorValues[1].value", "opcua", KNOWN_KEY)
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    lookup = await load_one(plans, uuid.UUID(dashboard_id))
    assert lookup.plan is not None
    assert lookup.plan.node_keys == (KNOWN_KEY,)


async def test_another_dashboards_bindings_stay_out_of_the_plan(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    dashboard_id, node_id = await make_twin_node(app_client)
    await bind(app_client, node_id, "anchorValues[0].value", "opcua", KNOWN_KEY)
    _other_id, other_node = await make_twin_node(app_client)
    await bind(
        app_client, other_node, "anchorValues[0].value", "opcua", ANOTHER_KEY
    )
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    lookup = await load_one(plans, uuid.UUID(dashboard_id))
    assert lookup.plan is not None
    assert lookup.plan.node_keys == (KNOWN_KEY,)


async def test_an_unchanged_dashboard_is_not_read_again(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    dashboard_id, node_id = await make_twin_node(app_client)
    await bind(app_client, node_id, "anchorValues[0].value", "opcua", KNOWN_KEY)
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    first = await load_one(plans, uuid.UUID(dashboard_id))
    second = await load_one(plans, uuid.UUID(dashboard_id), first.plan)
    assert second.is_reloaded is False
    assert second.plan is first.plan


async def test_a_new_binding_bumps_the_version_and_forces_a_reread(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    dashboard_id, node_id = await make_twin_node(app_client)
    await bind(app_client, node_id, "anchorValues[0].value", "opcua", KNOWN_KEY)
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    first = await load_one(plans, uuid.UUID(dashboard_id))
    await bind(
        app_client, node_id, "anchorValues[1].value", "opcua", ANOTHER_KEY
    )
    second = await load_one(plans, uuid.UUID(dashboard_id), first.plan)
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
    lookup = await load_one(plans, uuid.uuid4())
    assert lookup.plan is None
    assert lookup.is_reloaded is False


async def test_a_dashboard_without_bindings_plans_no_points(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await make_project(app_client, name="空项目")
    dashboard = await make_dashboard(app_client, project_id=project_id)
    await make_node(app_client, dashboard_id=str(dashboard["id"]))
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    lookup = await load_one(plans, uuid.UUID(str(dashboard["id"])))
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
    await bind(
        app_client, child_id, "anchorValues[0].value", "opcua", ANOTHER_KEY
    )
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    lookup = await load_one(plans, uuid.UUID(dashboard_id))
    assert lookup.plan is not None
    assert lookup.plan.node_keys == (ANOTHER_KEY,)
    assert NODES_URL.endswith("dashboard-nodes")


async def test_only_published_dashboards_carry_a_ticket(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # 匿名授权对账拿这条查询当权威：多取一行就是一条撤不掉的公开授权
    project_id = await make_project(app_client, name="发布态项目")
    published = await make_dashboard(app_client, project_id=project_id)
    hidden = await make_dashboard(
        app_client, project_id=project_id, name="没发布的"
    )
    minted = await app_client.post(
        f"{DASHBOARDS_URL}/{published['id']}:publish"
    )
    token = data_of(minted)["public_token"]

    rows = await publish_crud.published_dashboards(db_session)

    assert (uuid.UUID(str(published["id"])), token) in rows
    assert uuid.UUID(str(hidden["id"])) not in [row[0] for row in rows]


async def test_a_withdrawn_dashboard_drops_out_of_the_ticket_list(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await make_project(app_client, name="撤回项目")
    dashboard = await make_dashboard(app_client, project_id=project_id)
    await app_client.post(f"{DASHBOARDS_URL}/{dashboard['id']}:publish")
    await app_client.post(f"{DASHBOARDS_URL}/{dashboard['id']}:unpublish")

    rows = await publish_crud.published_dashboards(db_session)

    # 撤回把令牌置空，这一行必须当场消失，否则 hub 上那条授权注销不掉
    assert uuid.UUID(str(dashboard["id"])) not in [row[0] for row in rows]


async def test_a_batch_of_unchanged_dashboards_costs_one_query(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """在看的屏有多少张不影响查询条数——版本表只问一次。

    ⚠ 这是发布循环每一拍都要走的一步：按张各问一次的话，屏数就是每拍的
    往返数，而绝大多数拍里一张都没变。
    """
    first_id, first_node = await make_twin_node(app_client)
    await bind(
        app_client, first_node, "anchorValues[0].value", "opcua", KNOWN_KEY
    )
    second_id, second_node = await make_twin_node(app_client)
    await bind(
        app_client, second_node, "anchorValues[0].value", "opcua", ANOTHER_KEY
    )
    plans = DatabasePlanSource(database=SessionDatabase(db_session))
    ids = [uuid.UUID(first_id), uuid.UUID(second_id)]
    cached = {
        dashboard_id: lookup.plan
        for dashboard_id, lookup in (await plans.load_many(ids, {})).items()
        if lookup.plan is not None
    }

    with counted_selects() as statements:
        again = await plans.load_many(ids, cached)

    assert [lookup.is_reloaded for lookup in again.values()] == [False, False]
    assert len(statements) == 1, statements
