"""用户面。

⚠ `/users/me*` 必须声明在 `/users/{user_id}` **之前**，否则 `me` 会被当作
路径参数去解析成 UUID 而 422。它们也不复用管理端点：`/users*` 的路由规则要
`user:view`，普通用户查自己会在闸 1 就被拒。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.catalog import (
    USER_DELETE,
    USER_GRANT,
    USER_MANAGE,
    USER_VIEW,
)
from auth_server.apps.auth.deps import (
    get_container,
    get_identity,
    get_operation,
    get_session,
    require,
)
from auth_server.apps.auth.schemas import (
    AssignRoleIn,
    ChangePasswordIn,
    MeUpdateIn,
    ResetPasswordIn,
    SetPermissionsIn,
    UserCreateIn,
    UserDetailOut,
    UserFilters,
    UserListItemOut,
    UserUpdateIn,
)
from auth_server.apps.auth.services import (
    Identity,
    Operation,
    grant_service,
    user_service,
)
from auth_server.apps.auth.services.presenters import to_user_detail
from auth_server.container import Container
from auth_server.settings import API_PREFIX
from lib.web import ApiResponse, Page, PageParams, ok, page_params

router = APIRouter(prefix=f"{API_PREFIX}/users", tags=["user"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]
MeDep = Annotated[Identity, Depends(get_identity)]
PageDep = Annotated[PageParams, Depends(page_params)]
OperationDep = Annotated[Operation, Depends(get_operation)]


def user_filters(
    q: str | None = None,
    is_active: bool | None = None,
    role_id: uuid.UUID | None = None,
) -> UserFilters:
    """列表过滤条件依赖。

    Args: q, is_active, role_id。
    """
    return UserFilters(q=q, is_active=is_active, role_id=role_id)


FiltersDep = Annotated[UserFilters, Depends(user_filters)]
ViewDep = Annotated[Identity, Depends(require(USER_VIEW))]
ManageDep = Annotated[Identity, Depends(require(USER_MANAGE))]
DeleteDep = Annotated[Identity, Depends(require(USER_DELETE))]
GrantDep = Annotated[Identity, Depends(require(USER_GRANT))]


@router.get(
    "/me",
    response_model=ApiResponse[UserDetailOut],
    summary="当前用户（含权限码）",
)
async def read_me(identity: MeDep) -> ApiResponse[UserDetailOut]:
    """自服务端点，任意登录用户可访问，不要求权限码。

    Args: identity。
    """
    return ok(to_user_detail(identity))


@router.patch(
    "/me",
    response_model=ApiResponse[UserDetailOut],
    summary="改自己的资料",
)
async def update_me(
    payload: MeUpdateIn,
    session: SessionDep,
    container: ContainerDep,
    identity: MeDep,
) -> ApiResponse[UserDetailOut]:
    """只能改自己，且改不了启停、角色与权限。

    Args: payload, session, container, identity。
    """
    updated = await container.auth.update_me(
        session, user=identity.user, payload=payload
    )
    return ok(updated, message="资料已更新")


@router.post(
    "/me:change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="改自己的密码",
)
async def change_my_password(
    payload: ChangePasswordIn,
    session: SessionDep,
    container: ContainerDep,
    identity: MeDep,
) -> Response:
    """必须验旧密码。

    Args: payload, session, container, identity。
    """
    await container.auth.change_password(
        session, user=identity.user, payload=payload
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "",
    response_model=ApiResponse[Page[UserListItemOut]],
    summary="用户列表",
)
async def list_users(
    session: SessionDep,
    page: PageDep,
    filters: FiltersDep,
    _viewer: ViewDep,
    sort: str | None = None,
) -> ApiResponse[Page[UserListItemOut]]:
    """分页列出用户。

    Args: session, page, _viewer, filters, sort。
    """
    result = await user_service.list_users(
        session, filters=filters, page=page, sort=sort
    )
    return ok(result)


@router.post(
    "",
    response_model=ApiResponse[UserDetailOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建用户",
)
async def create_user(
    payload: UserCreateIn,
    session: SessionDep,
    container: ContainerDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> ApiResponse[UserDetailOut]:
    """建号。目标角色的权限集不得超过操作者。

    Args: payload, session, container, operation, _manager。
    """
    created = await user_service.create_user(
        session, operation, payload=payload, hasher=container.hasher
    )
    return ok(created, message="用户已创建")


@router.get(
    "/{user_id}",
    response_model=ApiResponse[UserDetailOut],
    summary="用户详情",
)
async def read_user(
    user_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[UserDetailOut]:
    """不存在与无权看见都返回 404。

    Args: user_id, session, _viewer。
    """
    return ok(await user_service.get_user(session, user_id))


@router.patch(
    "/{user_id}",
    response_model=ApiResponse[UserDetailOut],
    summary="更新用户资料",
)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdateIn,
    session: SessionDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> ApiResponse[UserDetailOut]:
    """改他人资料。

    Args: user_id, payload, session, operation, _manager。
    """
    updated = await user_service.update_user(
        session, operation, user_id=user_id, payload=payload
    )
    return ok(updated, message="用户已更新")


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除用户",
)
async def delete_user(
    user_id: uuid.UUID,
    session: SessionDep,
    operation: OperationDep,
    _deleter: DeleteDep,
) -> Response:
    """删已删的返回 404；不可删自己与最后一个全权账号。

    Args: user_id, session, operation, _deleter。
    """
    await user_service.delete_user(session, operation, user_id=user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{user_id}:activate",
    response_model=ApiResponse[UserDetailOut],
    summary="启用账号",
)
async def activate_user(
    user_id: uuid.UUID,
    session: SessionDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> ApiResponse[UserDetailOut]:
    """启用账号。

    Args: user_id, session, operation, _manager。
    """
    updated = await user_service.set_active(
        session, operation, user_id=user_id, is_active=True
    )
    return ok(updated, message="账号已启用")


@router.post(
    "/{user_id}:deactivate",
    response_model=ApiResponse[UserDetailOut],
    summary="停用账号",
)
async def deactivate_user(
    user_id: uuid.UUID,
    session: SessionDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> ApiResponse[UserDetailOut]:
    """停用账号。

    Args: user_id, session, operation, _manager。
    """
    updated = await user_service.set_active(
        session, operation, user_id=user_id, is_active=False
    )
    return ok(updated, message="账号已停用")


@router.post(
    "/{user_id}:reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="重置他人密码",
)
async def reset_password(
    user_id: uuid.UUID,
    payload: ResetPasswordIn,
    session: SessionDep,
    container: ContainerDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> Response:
    """重置他人密码。目标权限高于自己时拒绝。

    Args: user_id, payload, session, container, operation, _manager。
    """
    await user_service.reset_password(
        session,
        operation,
        user_id=user_id,
        payload=payload,
        hasher=container.hasher,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{user_id}:assign-role",
    response_model=ApiResponse[UserDetailOut],
    summary="改派角色",
)
async def assign_role(
    user_id: uuid.UUID,
    payload: AssignRoleIn,
    session: SessionDep,
    operation: OperationDep,
    _granter: GrantDep,
) -> ApiResponse[UserDetailOut]:
    """提权入口，受四条授权不变式约束。

    Args: user_id, payload, session, operation, _granter。
    """
    updated = await grant_service.assign_role(
        session, operation, user_id=user_id, payload=payload
    )
    return ok(updated, message="角色已改派")


@router.put(
    "/{user_id}/permissions",
    response_model=ApiResponse[UserDetailOut],
    summary="覆盖式写用户直权",
)
async def set_permissions(
    user_id: uuid.UUID,
    payload: SetPermissionsIn,
    session: SessionDep,
    operation: OperationDep,
    _granter: GrantDep,
) -> ApiResponse[UserDetailOut]:
    """给什么就是什么，不做增量合并。

    Args: user_id, payload, session, operation, _granter。
    """
    updated = await grant_service.set_direct_permissions(
        session, operation, user_id=user_id, payload=payload
    )
    return ok(updated, message="直权已更新")
