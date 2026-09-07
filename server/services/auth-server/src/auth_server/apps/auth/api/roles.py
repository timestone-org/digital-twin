"""角色面。读用 `user:view`，写用 `role:manage`。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.catalog import ROLE_MANAGE, USER_VIEW
from auth_server.apps.auth.deps import (
    get_container,
    get_operation,
    get_session,
    require,
)
from auth_server.apps.auth.schemas import (
    RoleCreateIn,
    RoleOut,
    RolePermissionsIn,
    RoleUpdateIn,
)
from auth_server.apps.auth.services import Identity, Operation, role_service
from auth_server.container import Container
from auth_server.settings import API_PREFIX
from lib.web import ApiResponse, Page, PageParams, ok, page_params

router = APIRouter(prefix=f"{API_PREFIX}/roles", tags=["role"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]
PageDep = Annotated[PageParams, Depends(page_params)]
OperationDep = Annotated[Operation, Depends(get_operation)]
ViewDep = Annotated[Identity, Depends(require(USER_VIEW))]
ManageDep = Annotated[Identity, Depends(require(ROLE_MANAGE))]


@router.get("", response_model=ApiResponse[Page[RoleOut]], summary="角色列表")
async def list_roles(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    q: str | None = None,
    sort: str | None = None,
) -> ApiResponse[Page[RoleOut]]:
    """分页列出角色。

    Args: session, page, _viewer, q, sort。
    """
    result = await role_service.list_roles(
        session, keyword=q, page=page, sort=sort
    )
    return ok(result)


@router.post(
    "",
    response_model=ApiResponse[RoleOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建角色",
)
async def create_role(
    payload: RoleCreateIn,
    session: SessionDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> ApiResponse[RoleOut]:
    """建角色，可同时授予一组权限码。

    Args: payload, session, operation, _manager。
    """
    created = await role_service.create_role(
        session, operation, payload=payload
    )
    return ok(created, message="角色已创建")


@router.get(
    "/{role_id}",
    response_model=ApiResponse[RoleOut],
    summary="角色详情",
)
async def read_role(
    role_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[RoleOut]:
    """角色详情。

    Args: role_id, session, _viewer。
    """
    return ok(await role_service.get_role(session, role_id))


@router.patch(
    "/{role_id}",
    response_model=ApiResponse[RoleOut],
    summary="更新角色",
)
async def update_role(
    role_id: uuid.UUID,
    payload: RoleUpdateIn,
    session: SessionDep,
    container: ContainerDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> ApiResponse[RoleOut]:
    """内置角色只允许改描述。

    Args: role_id, payload, session, container, operation, _manager。
    """
    updated = await role_service.update_role(
        session,
        operation,
        role_id=role_id,
        payload=payload,
        cache=container.identities,
    )
    return ok(updated, message="角色已更新")


@router.put(
    "/{role_id}/permissions",
    response_model=ApiResponse[RoleOut],
    summary="覆盖式设置角色权限",
)
async def set_role_permissions(
    role_id: uuid.UUID,
    payload: RolePermissionsIn,
    session: SessionDep,
    container: ContainerDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> ApiResponse[RoleOut]:
    """提权入口，受「授予不超过自身」与「角色不高于自身」两条约束。

    Args: role_id, payload, session, container, operation, _manager。
    """
    updated = await role_service.set_role_permissions(
        session,
        operation,
        role_id=role_id,
        payload=payload,
        cache=container.identities,
    )
    return ok(updated, message="角色权限已更新")


@router.delete(
    "/{role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除角色",
)
async def delete_role(
    role_id: uuid.UUID,
    session: SessionDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> Response:
    """内置角色不可删；角色下还有用户时先改派。

    Args: role_id, session, operation, _manager。
    """
    await role_service.delete_role(session, operation, role_id=role_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
