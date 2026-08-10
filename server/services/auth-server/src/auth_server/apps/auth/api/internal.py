"""内部端点：只在集群网内可达，边缘对 `/internal/` 一律 deny。

`/verify` 挂在这里而不是对外前缀下，是因为它的调用方就是边缘本身
（`auth_request` 子请求只能发 GET）。服务级密钥逐字比较，未配置即拒绝。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.deps import (
    get_container,
    get_session,
    require_service_key,
)
from auth_server.apps.auth.schemas import UserDetailOut
from auth_server.apps.auth.services import load_identity_by_id
from auth_server.apps.auth.services.presenters import to_user_detail
from auth_server.container import Container
from auth_server.settings import INTERNAL_PREFIX
from lib.web import ApiResponse, ok

router = APIRouter(
    prefix=INTERNAL_PREFIX,
    tags=["internal"],
    dependencies=[Depends(require_service_key)],
    include_in_schema=False,
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]

# 「用户确实不存在」的标记头。裸 404（路由不存在、前缀配错）不等于这件事，
# 下游只在收到本标记时才写负缓存
HEADER_USER_LOOKUP = "X-Auth-User-Lookup"


@router.get("/verify", summary="边缘鉴权子请求")
async def verify(
    session: SessionDep,
    container: ContainerDep,
    authorization: Annotated[str | None, Header()] = None,
    x_original_uri: Annotated[str | None, Header()] = None,
    x_original_method: Annotated[str | None, Header()] = None,
) -> Response:
    """先认证、再查规则。通过则 200 + 签名身份头。

    Args: session, container, authorization, x_original_uri,
        x_original_method。
    """
    headers = await container.verify.verify(
        session,
        authorization=authorization,
        path=x_original_uri or "/",
        method=x_original_method or "GET",
    )
    return Response(status_code=status.HTTP_200_OK, headers=headers)


@router.get(
    "/users/{user_id}/permissions",
    response_model=ApiResponse[UserDetailOut],
    summary="回查用户权限",
)
async def read_user_permissions(
    user_id: uuid.UUID, session: SessionDep
) -> ApiResponse[UserDetailOut] | Response:
    """上游验签失败时的回退查询。

    Args: user_id, session。
    """
    identity = await load_identity_by_id(session, user_id)
    if identity is None:
        return Response(
            status_code=status.HTTP_404_NOT_FOUND,
            headers={HEADER_USER_LOOKUP: "miss"},
        )
    return ok(to_user_detail(identity))
