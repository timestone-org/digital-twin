"""绑定面。

⚠ `node_id` 是**画布节点**的 id，`node_key` 是**采集点位**的身份，两者不是
一回事（docs/DASHBOARD_DESIGN.md §1）。
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
    BindingCreateIn,
    BindingOut,
    BindingUpdateIn,
)
from platform_server.apps.dashboard.services import (
    ValidationContext,
    binding_service,
)
from platform_server.settings import API_PREFIX

router = APIRouter(tags=["dashboard-binding"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(DASHBOARD_VIEW))]
EditDep = Annotated[WriteContext, Depends(get_edit_context)]


def _create_action(
    session: AsyncSession,
    node_id: uuid.UUID,
    payload: BindingCreateIn,
    context: ValidationContext,
) -> Callable[[], Awaitable[BindingOut]]:
    """把一次建绑定包成可重放的动作。

    Args: session, node_id, payload, context。
    """
    return lambda: binding_service.create_binding(
        session, node_id=node_id, payload=payload, context=context
    )


@router.post(
    f"{API_PREFIX}/dashboard-nodes/{{node_id}}/bindings",
    response_model=ApiResponse[BindingOut],
    status_code=status.HTTP_201_CREATED,
    summary="新增绑定",
)
async def create_binding(
    node_id: uuid.UUID,
    payload: BindingCreateIn,
    session: SessionDep,
    response: Response,
    write: EditDep,
) -> ApiResponse[BindingOut]:
    """建绑定。支持 `Idempotency-Key`。

    Args: node_id, payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_dashboard_binding",
        model=BindingOut,
        action=_create_action(session, node_id, payload, write.validation),
    )
    response.headers["Location"] = (
        f"{API_PREFIX}/dashboard-bindings/{created.id}"
    )
    return ok(created, message="绑定已创建")


@router.get(
    f"{API_PREFIX}/dashboard-bindings",
    response_model=ApiResponse[list[BindingOut]],
    summary="绑定列表",
)
async def list_bindings(
    node_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[list[BindingOut]]:
    """一个节点的全部绑定。集合有界（槽位由模块清单定死），故不分页。

    Args: node_id, session, _viewer。
    """
    return ok(await binding_service.list_bindings(session, node_id=node_id))


@router.patch(
    f"{API_PREFIX}/dashboard-bindings/{{binding_id}}",
    response_model=ApiResponse[BindingOut],
    summary="更新绑定",
)
async def update_binding(
    binding_id: uuid.UUID,
    payload: BindingUpdateIn,
    session: SessionDep,
    write: EditDep,
) -> ApiResponse[BindingOut]:
    """改绑定。换槽要删了重建。

    Args: binding_id, payload, session, write。
    """
    updated = await binding_service.update_binding(
        session,
        binding_id=binding_id,
        payload=payload,
        context=write.validation,
    )
    return ok(updated, message="绑定已更新")


@router.delete(
    f"{API_PREFIX}/dashboard-bindings/{{binding_id}}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除绑定",
)
async def delete_binding(
    binding_id: uuid.UUID, session: SessionDep, _write: EditDep
) -> Response:
    """删绑定。

    Args: binding_id, session, _write。
    """
    await binding_service.delete_binding(session, binding_id=binding_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
