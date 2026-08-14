"""发布面用例的共用造件：绑点、以及把用例那条事务当成「库」的适配件。

⚠ 必须与 HTTP 那侧共用同一条连接：分开连就是两个事务，用例经接口种下的绑定
在发布计划那边根本看不见，而现象是「计划里一个点位都没有」，看着像查询写错。
"""

import contextlib
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx
from conftest import SEEDED_SOURCE_ID
from sqlalchemy.ext.asyncio import AsyncSession

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    HTTP_CREATED,
    NODES_URL,
    data_of,
    make_dashboard,
    make_project,
    node_body,
)

KNOWN_KEY = f"{SEEDED_SOURCE_ID}:outlet_temp"
ANOTHER_KEY = f"{SEEDED_SOURCE_ID}:inlet_temp"


@dataclass(frozen=True)
class SessionDatabase:
    """把用例那条回滚事务包成 `Database` 的最小面。"""

    session_in_use: AsyncSession

    @contextlib.asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        """交出用例正在用的那条会话，出块不提交也不关。"""
        yield self.session_in_use


async def make_twin_node(client: httpx.AsyncClient) -> tuple[str, str]:
    """建一张大屏并在上面放一个能绑点的节点，回 (大屏 id, 节点 id)。

    Args: client。
    """
    project_id = await make_project(client, name="发布面项目")
    dashboard = await make_dashboard(client, project_id=project_id)
    dashboard_id = str(dashboard["id"])
    response = await client.post(
        f"{DASHBOARDS_URL}/{dashboard_id}/nodes",
        json=node_body(module_type="twin-view"),
    )
    assert response.status_code == HTTP_CREATED
    return dashboard_id, str(data_of(response)["id"])


async def bind(
    client: httpx.AsyncClient,
    node_id: str,
    field_key: str,
    source_kind: str,
    node_key: str,
) -> None:
    """给节点的一个槽接上一个点位。

    Args: client, node_id, field_key, source_kind, node_key。
    """
    body = {
        "field_key": field_key,
        "source_kind": source_kind,
        "node_key": node_key,
    }
    if source_kind == "archive":
        body["detail_json"] = {
            "node_key": node_key,
            "range": {"last_window": "1h"},
        }
    response = await client.post(f"{NODES_URL}/{node_id}/bindings", json=body)
    assert response.status_code == HTTP_CREATED
