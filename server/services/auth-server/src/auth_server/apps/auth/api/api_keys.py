"""API 密钥面：第三方系统的常驻凭据。

⚠ 明文只在 `POST /api-keys` 的响应里出现一次，之后任何读面都拿不回来——
库里只有 argon2id 散列。丢了只能吊销重发，这是刻意的。

⚠ 没有 DELETE，只有 `:revoke`。删掉一行等于把这枚密钥的存在本身从审计里
抹掉，而密钥的价值有一半在于事后能查清是谁在用。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.catalog import USER_MANAGE, USER_VIEW
from auth_server.apps.auth.deps import (
    get_container,
    get_operation,
    get_session,
    require,
)
from auth_server.apps.auth.schemas import (
    ApiKeyCreateIn,
    ApiKeyFilters,
    ApiKeyOut,
    ApiKeySecretOut,
)
from auth_server.apps.auth.services import Identity, Operation, api_key_service
from auth_server.container import Container
from auth_server.settings import API_PREFIX
from lib.web import ApiResponse, Page, PageParams, ok, page_params

router = APIRouter(prefix=f"{API_PREFIX}/api-keys", tags=["api-key"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]
PageDep = Annotated[PageParams, Depends(page_params)]
OperationDep = Annotated[Operation, Depends(get_operation)]
ViewDep = Annotated[Identity, Depends(require(USER_VIEW))]
ManageDep = Annotated[Identity, Depends(require(USER_MANAGE))]


def api_key_filters(
    user_id: uuid.UUID | None = None, should_include_revoked: bool = False
) -> ApiKeyFilters:
    """列表过滤条件依赖。

    Args: user_id, should_include_revoked。
    """
    return ApiKeyFilters(
        user_id=user_id, should_include_revoked=should_include_revoked
    )


FiltersDep = Annotated[ApiKeyFilters, Depends(api_key_filters)]


@router.get(
    "", response_model=ApiResponse[Page[ApiKeyOut]], summary="API 密钥列表"
)
async def list_api_keys(
    session: SessionDep,
    container: ContainerDep,
    page: PageDep,
    filters: FiltersDep,
    _viewer: ViewDep,
) -> ApiResponse[Page[ApiKeyOut]]:
    """分页列出密钥。只出前缀，明文不在这里。

    Args: session, container, page, filters, _viewer。
    """
    result = await api_key_service.list_keys(
        session,
        filters=filters,
        page=page,
        now=container.api_keys.clock(),
    )
    return ok(result)


@router.post(
    "",
    response_model=ApiResponse[ApiKeySecretOut],
    status_code=status.HTTP_201_CREATED,
    summary="签发 API 密钥",
)
async def issue_api_key(
    payload: ApiKeyCreateIn,
    session: SessionDep,
    container: ContainerDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> ApiResponse[ApiKeySecretOut]:
    """签发。目标账号权限高于自己时拒绝。

    Args: payload, session, container, operation, _manager。
    """
    created = await container.api_keys.issue(
        session, operation, payload=payload
    )
    return ok(created, message="密钥已签发，明文只显示这一次")


@router.post(
    "/{key_id}:revoke",
    response_model=ApiResponse[ApiKeyOut],
    summary="吊销 API 密钥",
)
async def revoke_api_key(
    key_id: uuid.UUID,
    session: SessionDep,
    container: ContainerDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> ApiResponse[ApiKeyOut]:
    """吊销后立即失效，重复吊销无副作用。

    Args: key_id, session, container, operation, _manager。
    """
    revoked = await container.api_keys.revoke(session, operation, key_id=key_id)
    return ok(revoked, message="密钥已吊销")
