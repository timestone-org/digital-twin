"""FastAPI 依赖注入件 —— 闸 2。

闸 1（路由规则）在边缘执行，绕过边缘直连端口时它不生效；闸 2 贴着代码，
**任何路径都生效**。两者对同一端点的权限码必须一致，由契约测试锁死。

⚠ 本服务与 auth-server 的认证方式相反：auth-server 读 Bearer 令牌（它自己
就是发令牌的人），本服务读边缘注入的 `X-Auth-*` 签名头，用
`edge_signing_secret` 验签——头可以伪造，签名不能。

⚠ 这里没有请求级的 session 依赖。本服务的动作端点要在事务外做外部 IO
（起停实例、写节点值），事务边界因此归 service 层自己持有，见
`docs/agents/database-standard.md`「禁事务内做外部 IO」。
"""

import hmac
from collections.abc import Awaitable, Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, Request

from lib.auth import (
    CallerContext,
    SignedContext,
    decode_identity,
    decode_permissions,
    verify_context,
)
from lib.errors import PermissionDenied, Unauthenticated
from lib.utils.timeutils import utcnow
from opcua_server.container import Container

# 端点声明自己要的权限码，契约测试遍历路由时读它
REQUIRED_CODES_ATTR = "__auth_required_codes__"
REQUIRED_MODE_ATTR = "__auth_required_mode__"

# 三档权限码。⚠ 它们的**登记**在 auth-server 的 catalog.py（全系统唯一真源），
# 这里只是消费方的字面量；两处一致由契约测试与种子同批上线保证。
# 分三档而非两档：「能看」与「能改上位机读到的值」差一个量级的风险——
# 写值在物理上等价于对现场下指令。
PERM_VIEW = "opcua:view"
PERM_OPERATE = "opcua:operate"
PERM_MANAGE = "opcua:manage"

HEADER_USER_ID = "X-Auth-User-Id"
HEADER_USERNAME = "X-Auth-Username"
HEADER_ROLE = "X-Auth-Role"
HEADER_PERMISSIONS = "X-Auth-Permissions"
HEADER_TRUNCATED = "X-Auth-Permissions-Truncated"
HEADER_EXPIRES = "X-Auth-Exp"
HEADER_SIGNATURE = "X-Auth-Sig"


def get_container(request: Request) -> Container:
    """取组合根。

    Args: request。
    """
    container = request.app.state.container
    # pragma 理由：装配失败时进程根本起不来，这条分支没有可达的测试路径
    if not isinstance(container, Container):  # pragma: no cover
        raise RuntimeError("应用未装配 container")
    return container


async def get_caller(
    request: Request,
    container: Annotated[Container, Depends(get_container)],
) -> CallerContext:
    """从边缘注入的签名头还原调用者身份。

    ⚠ 直接读 `request.headers` 而不是声明成七个 Header 形参：那些头是**边缘
    注入**的，写进 OpenAPI 会诱导客户端自己发一份伪造的。

    ⚠ 权限头被截断时**一律拒绝**：此时我们不知道调用者有哪些码，
    放行等于按一个可能错误的假设行事。

    Args: request, container。
    """
    headers = request.headers
    if headers.get(HEADER_TRUNCATED):
        raise Unauthenticated("权限集过大，边缘未能完整下发")
    user_id = headers.get(HEADER_USER_ID)
    signature = headers.get(HEADER_SIGNATURE)
    expires_at = headers.get(HEADER_EXPIRES)
    if not user_id or not signature or not expires_at:
        raise Unauthenticated("缺少身份头，请经边缘网关访问")
    permissions_b64 = headers.get(HEADER_PERMISSIONS) or ""
    role = headers.get(HEADER_ROLE) or ""
    context = SignedContext(
        user_id=user_id,
        role=role,
        permissions_b64=permissions_b64,
        expires_at=_as_int(expires_at),
    )
    secret = container.settings.edge_signing_secret.get_secret_value()
    if not verify_context(
        secret, context, signature=signature, now=int(utcnow().timestamp())
    ):
        raise Unauthenticated("身份头签名不符或已过期")
    return CallerContext(
        user_id=_as_uuid(user_id),
        username=decode_identity(headers.get(HEADER_USERNAME)),
        role=decode_identity(role),
        permissions=decode_permissions(permissions_b64),
    )


def require(
    *codes: str, mode: str = "all"
) -> Callable[[CallerContext], Awaitable[CallerContext]]:
    """闸 2：要求调用者持有给定权限码。

    Args: codes, mode（`all` 全持有 / `any` 任一即可）。
    """
    required = frozenset(codes)

    async def dependency(
        caller: Annotated[CallerContext, Depends(get_caller)],
    ) -> CallerContext:
        satisfied = (
            caller.has_any(required)
            if mode == "any"
            else caller.has_all(required)
        )
        if not satisfied:
            raise PermissionDenied("没有该操作的权限")
        return caller

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
        raise Unauthenticated("服务级密钥缺失")
    if not hmac.compare_digest(expected, x_service_key):
        raise Unauthenticated("服务级密钥不符")


def get_idempotency_key(
    idempotency_key: Annotated[str | None, Header()] = None,
) -> str | None:
    """取幂等键。

    ⚠ 写值与创建资源必须支持它：网络抖动导致的客户端重试，在没有幂等键时
    会向上位机可见的地址空间**写两次**（api-contract §7）。

    Args: idempotency_key。
    """
    return idempotency_key


def _as_int(raw: str) -> int:
    try:
        return int(raw)
    except ValueError as error:
        raise Unauthenticated("身份头的过期时刻不是整数") from error


def _as_uuid(raw: str) -> UUID:
    try:
        return UUID(raw)
    except ValueError as error:
        raise Unauthenticated("身份头的主体不是合法标识") from error
