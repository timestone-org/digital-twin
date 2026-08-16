"""删点位前的绑定检查：被大屏绑着就 409 并列出那些大屏。

这条守卫正是配置面必须留在 platform 的理由（ADR-0001 理由一）——绑定表就在
同一个库里，问一句是进程内调用；配置面跟着采集运行时走就得反向 RPC 回来问。
"""

from dataclasses import dataclass

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.collect_helpers import (
    POINTS,
    create_points,
    create_source,
    envelope,
    payload,
    point_item,
)
from integration.dashboard_helpers import (
    HTTP_CREATED,
    NODES_URL,
    make_dashboard,
    make_node,
    make_project,
    node_body,
)
from platform_server.apps.dashboard.services import dashboards_binding

pytestmark = pytest.mark.requires_postgres

BINDING_SLOT = "anchorValues[0].value"


@dataclass(frozen=True)
class AnyPointCatalog:
    """一份「问什么都在」的点位台账。

    ⚠ 本模块的点位是用例现场建出来的，`source_id` 是库发的 UUIDv7，写不进
    conftest 那份固定名单；而这里要验的是删除守卫，不是绑定校验本身。
    """

    async def known_node_keys(
        self, node_keys: frozenset[str]
    ) -> frozenset[str]:
        return node_keys


@pytest.fixture
def point_catalog() -> AnyPointCatalog:
    """顶掉 conftest 的固定名单，让现场建出来的点位也绑得上。"""
    return AnyPointCatalog()


async def bind_point(
    client: httpx.AsyncClient, *, node_key: str, name: str
) -> tuple[str, str]:
    """建一张绑着该点位的大屏，返回 `(大屏 id, 节点 id)`。

    Args: client, node_key, name。
    """
    project_id = await make_project(client, name=f"{name} 项目")
    dashboard = await make_dashboard(client, project_id=project_id, name=name)
    node = await make_node(
        client,
        dashboard_id=dashboard["id"],
        body=node_body(module_type="twin-view"),
    )
    response = await client.post(
        f"{NODES_URL}/{node['id']}/bindings",
        json={
            "field_key": BINDING_SLOT,
            "source_kind": "opcua",
            "node_key": node_key,
        },
    )
    assert response.status_code == HTTP_CREATED, response.text
    return str(dashboard["id"]), str(node["id"])


async def test_a_bound_point_cannot_be_deleted(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    point = batch["items"][0]
    dashboard_id, _ = await bind_point(
        app_client, node_key=point["node_key"], name="一号大屏"
    )
    response = await app_client.delete(f"{POINTS}/{point['id']}")
    assert response.status_code == 409
    body = envelope(response)
    assert body["code"] == 41105
    assert body["details"][0]["field"] == f"dashboards[{dashboard_id}]"
    assert "一号大屏" in body["details"][0]["message"]


async def test_the_conflict_lists_every_dashboard_that_binds_it(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    point = batch["items"][0]
    await bind_point(app_client, node_key=point["node_key"], name="一号大屏")
    await bind_point(app_client, node_key=point["node_key"], name="二号大屏")
    response = await app_client.delete(f"{POINTS}/{point['id']}")
    assert response.status_code == 409
    messages = [item["message"] for item in envelope(response)["details"]]
    assert len(messages) == 2
    assert "一号大屏" in messages[0]
    assert "二号大屏" in messages[1]


async def test_a_point_nobody_binds_deletes_cleanly(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    batch = await create_points(
        app_client,
        source["id"],
        point_item("outlet_temp"),
        point_item("inlet_temp"),
    )
    free, bound = batch["items"][0], batch["items"][1]
    await bind_point(app_client, node_key=bound["node_key"], name="一号大屏")
    response = await app_client.delete(f"{POINTS}/{free['id']}")
    assert response.status_code == 204


async def test_removing_the_binding_frees_the_point(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    point = batch["items"][0]
    _, node_id = await bind_point(
        app_client, node_key=point["node_key"], name="一号大屏"
    )
    await app_client.delete(f"{NODES_URL}/{node_id}")
    response = await app_client.delete(f"{POINTS}/{point['id']}")
    assert response.status_code == 204


async def test_a_bound_point_survives_the_refused_delete(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    point = batch["items"][0]
    await bind_point(app_client, node_key=point["node_key"], name="一号大屏")
    await app_client.delete(f"{POINTS}/{point['id']}")
    listed = await app_client.get(POINTS, params={"source_id": source["id"]})
    assert [item["id"] for item in payload(listed)["items"]] == [point["id"]]


async def test_asking_about_no_points_costs_no_query(
    db_session: AsyncSession,
) -> None:
    assert await dashboards_binding(db_session, []) == {}


async def test_force_delete_removes_a_bound_point(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ force 是显式跳过绑定守卫：仍绑着它的大屏引用就此失效，
    # 界面要在二次确认里把这句话说出来
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    point = batch["items"][0]
    await bind_point(app_client, node_key=point["node_key"], name="一号大屏")
    response = await app_client.delete(
        f"{POINTS}/{point['id']}", params={"force": "true"}
    )
    assert response.status_code == 204
    listed = await app_client.get(POINTS, params={"source_id": source["id"]})
    ids = [item["id"] for item in payload(listed)["items"]]
    assert point["id"] not in ids
