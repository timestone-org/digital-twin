"""FastAPI 依赖注入件 —— 闸 2。

闸 1（路由规则）在边缘执行，绕过边缘直连端口时它不生效；闸 2 贴着代码，
**任何路径都生效**。两者对同一端点的权限码必须一致，由契约测试锁死。

⚠ 本服务不自己校验令牌：它读的是边缘调过 auth-server `/verify` 之后注入的
签名身份头。签名是关键——没有它，任何人直接 `curl -H "X-Auth-Permissions: …"`
就是超管。
"""

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.errors import PermissionDenied, Unauthenticated
from lib.utils.timeutils import utcnow
from platform_server.apps.hvac.services import caller_from_headers
from platform_server.container import Container

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


async def get_caller(
    request: Request,
    container: Annotated[Container, Depends(get_container)],
) -> CallerContext:
    """从边缘注入的签名身份头解出调用者。验不过一律 401。

    Args: request, container。
    """
    caller = caller_from_headers(
        request.headers,
        signing_secret=(
            container.settings.edge_signing_secret.get_secret_value()
        ),
        now=utcnow(),
    )
    if caller is None:
        raise Unauthenticated("身份信息缺失或已过期，请重新登录")
    return caller


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
