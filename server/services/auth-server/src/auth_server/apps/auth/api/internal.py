"""内部端点：只在集群网内可达，边缘对 `/internal/` 一律 deny。

`/verify` 挂在这里而不是对外前缀下，是因为它的调用方就是边缘本身
（`auth_request` 子请求只能发 GET）。服务级密钥逐字比较，未配置即拒绝。

⚠ `/users/{id}/edge-headers` 是一个**签发面**，给的是当下从库里读出来的权限集。
它存在是因为签名头只活几十秒，而被委托方（助手推进一个回合）能跑上几分钟——
到期之后它代表用户发的每一个请求都是 401，现象落在工具上而原因在这里。
正解是回查权限换一份新的，不是把过期时刻往后挪：后者会把全站的吊销窗口一起
放大。拿着服务级密钥就能为任意用户签出身份头，之所以可以这样，是因为每个服务
本来就持有同一把签名密钥，签发能力早已在集群内；这道端点只是把它收回到唯一的
签发者手上。与 `/verify` 不同，这里**不查路由规则**：续的是一次已经放行过的
委托，而闸 1 认的是「客户端在访问哪条路径」，此刻并没有那样一条路径；被委托方
读得到什么仍由目标服务的闸 2 按这份权限集判定。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth import catalog
from auth_server.apps.auth.deps import (
    get_container,
    get_session,
    require_service_key,
)
from auth_server.apps.auth.errors import AccountDisabled
from auth_server.apps.auth.schemas import PermissionCodesOut, UserDetailOut
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


@router.get("/users/{user_id}/edge-headers", summary="重新签发身份头")
async def reissue_edge_headers(
    user_id: uuid.UUID, session: SessionDep, container: ContainerDep
) -> Response:
    """按用户 id 重新签一份身份头。停用的账号一律拒。

    Args: user_id, session, container。
    """
    identity = await load_identity_by_id(session, user_id)
    if identity is None:
        return Response(
            status_code=status.HTTP_404_NOT_FOUND,
            headers={HEADER_USER_LOOKUP: "miss"},
        )
    if not identity.user.is_active:
        raise AccountDisabled("账号已停用")
    return Response(
        status_code=status.HTTP_200_OK,
        headers=container.verify.build_headers(identity),
    )


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


@router.get(
    "/permission-codes",
    response_model=ApiResponse[PermissionCodesOut],
    summary="权限码字面量全集",
)
async def read_permission_codes() -> ApiResponse[PermissionCodesOut]:
    """给别的服务校验「某个权限码存不存在」用。

    调用方是 realtime-hub：主题登记时要校验推送方声明的码在目录里
    （[ADR-0007](../../../../../../docs/adr/0007-实时通道薄化与开放主题命名空间.md)
    §决策 4）。它挡的是「编造一个不存在的码」。

    ⚠ 读的是 `catalog.py` 的字面量而不是 DB 里那张表：目录的真源是代码，
    DB 那份是种子同步过去的投影。查库会让「种子还没跑」这一刻的答案变成
    「这个码不存在」——而那时代码里明明有，登记会被拒得莫名其妙。

    ⚠ 不分页：码的数量是个位数到几十，且调用方要的就是全集做集合判断。
    """
    return ok(PermissionCodesOut(codes=sorted(catalog.ALL_CODES)))
