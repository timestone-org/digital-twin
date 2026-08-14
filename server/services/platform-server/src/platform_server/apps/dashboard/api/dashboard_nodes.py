"""画布节点面。

⚠ 顶层资源名带 `dashboard-` 前缀：platform 这一个服务里同时有采集点位与画布
节点，而 `opcua-server` 那边还有第三种 `nodes`（地址空间节点）。
"""

import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.dashboard.catalog import DASHBOARD_VIEW
from platform_server.apps.dashboard.deps import (
    WriteContext,
    get_edit_context,
    get_session,
    require,
)
from platform_server.apps.dashboard.schemas import (
    NodeCreateIn,
    NodeOut,
    NodeUpdateIn,
)
from platform_server.apps.dashboard.services import (
    ValidationContext,
    node_service,
)
from platform_server.settings import API_PREFIX

router = APIRouter(tags=["dashboard-node"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(DASHBOARD_VIEW))]
EditDep = Annotated[WriteContext, Depends(get_edit_context)]


def _create_action(
    session: AsyncSession,
    dashboard_id: uuid.UUID,
    payload: NodeCreateIn,
    context: ValidationContext,
) -> Callable[[], Awaitable[NodeOut]]:
    """把一次建节点包成可重放的动作。

    Args: session, dashboard_id, payload, context。
    """
    return lambda: node_service.create_node(
        session, dashboard_id=dashboard_id, payload=payload, context=context
    )


@router.post(
    f"{API_PREFIX}/dashboards/{{dashboard_id}}/nodes",
    response_model=ApiResponse[NodeOut],
    status_code=status.HTTP_201_CREATED,
    summary="新增节点",
)
async def create_node(
    dashboard_id: uuid.UUID,
    payload: NodeCreateIn,
    session: SessionDep,
    response: Response,
    write: EditDep,
) -> ApiResponse[NodeOut]:
    """建节点。支持 `Idempotency-Key`。

    Args: dashboard_id, payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_dashboard_node",
        model=NodeOut,
        action=_create_action(session, dashboard_id, payload, write.validation),
    )
    response.headers["Location"] = f"{API_PREFIX}/dashboard-nodes/{created.id}"
    return ok(created, message="节点已创建")


@router.get(
    f"{API_PREFIX}/dashboard-nodes",
    response_model=ApiResponse[list[NodeOut]],
    summary="节点列表",
)
async def list_nodes(
    dashboard_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[list[NodeOut]]:
    """一张大屏的全部节点。集合有界（一屏节点数有上限），故不分页。

    Args: dashboard_id, session, _viewer。
    """
    return ok(await node_service.list_nodes(session, dashboard_id=dashboard_id))


@router.get(
    f"{API_PREFIX}/dashboard-nodes/{{node_id}}",
    response_model=ApiResponse[NodeOut],
    summary="节点详情",
)
async def read_node(
    node_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[NodeOut]:
    """节点详情，连绑定一起给。

    Args: node_id, session, _viewer。
    """
    return ok(await node_service.get_node(session, node_id))


@router.patch(
    f"{API_PREFIX}/dashboard-nodes/{{node_id}}",
    response_model=ApiResponse[NodeOut],
    summary="更新节点",
)
async def update_node(
    node_id: uuid.UUID,
    payload: NodeUpdateIn,
    session: SessionDep,
    write: EditDep,
) -> ApiResponse[NodeOut]:
    """改节点。id 不变。

    Args: node_id, payload, session, write。
    """
    updated = await node_service.update_node(
        session, node_id=node_id, payload=payload, context=write.validation
    )
    return ok(updated, message="节点已更新")


@router.delete(
    f"{API_PREFIX}/dashboard-nodes/{{node_id}}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除节点",
)
async def delete_node(
    node_id: uuid.UUID, session: SessionDep, _write: EditDep
) -> Response:
    """删节点，连它的子树。

    Args: node_id, session, _write。
    """
    await node_service.delete_node(session, node_id=node_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
