"""FastAPI 依赖注入件 —— 闸 2。

闸 1（路由规则）在边缘执行，绕过边缘直连端口时它不生效；闸 2 贴着代码，
**任何路径都生效**。两者对同一端点的权限码必须一致，由契约测试锁死。
"""

import hmac
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.errors import (
    AccountDisabled,
    PermissionRequired,
    ServiceKeyInvalid,
    TokenInvalid,
)
from auth_server.apps.auth.services import (
    Identity,
    Operation,
    load_identity_by_id,
    looks_like_api_key,
)
from auth_server.apps.auth.services.token_service import parse_bearer
from auth_server.container import Container

# 端点声明自己要的权限码，契约测试遍历路由时读它
REQUIRED_CODES_ATTR = "__auth_required_codes__"
REQUIRED_MODE_ATTR = "__auth_required_mode__"


def get_container(request: Request) -> Container:
    """取组合根。

    Args: request。
    """
    container = request.app.state.container
    # pragma 理由：装配失败时进程根本起不来，这条分支没有可达的测试路径
    if not isinstance(container, Container):  # pragma: no cover
        raise RuntimeError("应用未装配 container")
    return container


async def get_session(
    container: Annotated[Container, Depends(get_container)],
) -> AsyncIterator[AsyncSession]:
    """一个请求一个事务：正常出块提交，异常回滚。

    Args: container。
    """
    async with container.database.session() as session:
        yield session


async def get_identity(
    session: Annotated[AsyncSession, Depends(get_session)],
    container: Annotated[Container, Depends(get_container)],
    authorization: Annotated[str | None, Header()] = None,
) -> Identity:
    """从 Bearer 令牌解出调用者身份。

    ⚠ 本服务**不读** `X-Auth-*` 头来认证自己的端点：那些头由边缘在调过
    `/verify` 之后注入，用它认证会让 auth-server 的鉴权依赖边缘配置正确。

    ⚠ 本服务的管理面**只认账号令牌**，API 密钥一律拒绝。密钥是给机器调业务
    接口用的；放它进来，一枚被盗的密钥就能给自己再签一枚，吊销永远追不上
    签发。这里显式判前缀而不是让它掉进「令牌无效」，是为了让现象贴着原因。

    Args: session, container, authorization。
    """
    token = parse_bearer(authorization)
    if token is None:
        raise TokenInvalid("未提供访问令牌")
    if looks_like_api_key(token):
        raise TokenInvalid("API 密钥不能用于账号管理面，请改用账号令牌")
    claims = container.tokens.decode_access(token)
    identity = await load_identity_by_id(session, _as_uuid(claims.subject))
    if identity is None:
        raise TokenInvalid("令牌对应的账号不存在")
    if not identity.user.is_active:
        raise AccountDisabled("账号已停用，请联系管理员")
    return identity


async def get_operation(
    request: Request,
    identity: Annotated[Identity, Depends(get_identity)],
) -> Operation:
    """一次写操作的调用者与来源 IP。

    Args: request, identity。
    """
    return Operation(operator=identity, source_ip=_client_ip(request))


def require(
    *codes: str, mode: str = "all"
) -> Callable[[Identity], Awaitable[Identity]]:
    """闸 2：要求调用者持有给定权限码。

    Args: codes, mode（`all` 全持有 / `any` 任一即可）。
    """
    required = frozenset(codes)

    async def dependency(
        identity: Annotated[Identity, Depends(get_identity)],
    ) -> Identity:
        satisfied = (
            identity.has_any(required)
            if mode == "any"
            else identity.has_all(required)
        )
        if not satisfied:
            raise PermissionRequired("没有该操作的权限")
        return identity

    setattr(dependency, REQUIRED_CODES_ATTR, required)
    setattr(dependency, REQUIRED_MODE_ATTR, mode)
    return dependency


async def require_service_key(
    container: Annotated[Container, Depends(get_container)],
    x_service_key: Annotated[str | None, Header()] = None,
) -> None:
    """内部端点的服务级密钥。⚠ 未配置或不符一律拒绝，不是放行。

    Args: container, x_service_key。
    """
    expected = container.settings.edge_service_key.get_secret_value()
    if not expected or not x_service_key:
        raise ServiceKeyInvalid("服务级密钥缺失")
    if not hmac.compare_digest(expected, x_service_key):
        raise ServiceKeyInvalid("服务级密钥不符")


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _as_uuid(raw: str) -> UUID:
    try:
        return UUID(raw)
    except ValueError as error:
        raise TokenInvalid("令牌主体不是合法标识") from error
