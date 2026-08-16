"""FastAPI 依赖注入件 —— 闸 2 与内部面的服务级密钥。

闸 1（路由规则）在边缘执行，绕过边缘直连端口时它不生效；闸 2 贴着代码，
**任何路径都生效**。两者对同一端点的权限码必须一致，由契约测试锁死。

⚠ 本服务不自己校验令牌：它读的是边缘调过 auth-server `/verify` 之后注入的
签名身份头。签名是关键——没有它，任何人直接 `curl -H "X-Auth-Permissions: …"`
就是超管。
"""

import hmac
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.errors import PermissionDenied, Unauthenticated
from lib.utils.timeutils import utcnow
from platform_server.apps.collect.catalog import (
    COLLECT_MANAGE,
    COLLECT_OPERATE,
)
from platform_server.apps.collect.errors import IdempotencyKeyRequired
from platform_server.apps.collect.services import CommandBus, PlanNotifier
from platform_server.apps.collect.services.source_service import SourceContext
from platform_server.apps.collect.services.state_source import (
    SourceStateSource,
)

# ⚠ 幂等存储与边缘身份头的解码都是服务级公共件，眼下住在别的功能模块的
# services 公开面里；跨功能模块只走 services 公开面，故这里取的是它们
from platform_server.apps.dashboard.services import IdempotencyStore
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


def get_source_context(
    container: Annotated[Container, Depends(get_container)],
) -> SourceContext:
    """数据源出参要的旁路信息。测试用 `dependency_overrides` 换成假件。

    Args: container。
    """
    return SourceContext(
        states=SourceStateSource(history=container.history),
        live_point_limit=container.settings.collect_live_max_points,
        cipher=container.credential_cipher,
    )


def get_idempotency_key(
    idempotency_key: Annotated[str | None, Header()] = None,
) -> str | None:
    """取幂等键。

    Args: idempotency_key。
    """
    return idempotency_key


def require_idempotency_key(
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> str:
    """下发写值必须带幂等键，没带直接 400。

    ⚠ 这里比 api-contract §7 的「支持」更严：写超时按不可重试处理，调用方要
    重试就只能靠同一个幂等键，没有它这条路径根本不安全。
    Args: idempotency_key。
    """
    if not idempotency_key:
        raise IdempotencyKeyRequired("下发写值必须带 Idempotency-Key 请求头")
    return idempotency_key


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


@dataclass(frozen=True)
class WriteContext:
    """一次写请求要的全套：幂等键、调用者、命令总线与计划广播口。

    ⚠ 打成一包不是为了好看：路由函数的形参上限是 5，而写端点天然需要
    「谁在写、这次写幂等吗、往哪发命令、改完通知谁」四件事。
    """

    idempotency: IdempotencyStore
    idempotency_key: str | None
    caller: CallerContext
    bus: CommandBus
    plans: PlanNotifier

    async def run_once[ResultT: BaseModel](
        self,
        *,
        endpoint: str,
        model: type[ResultT],
        action: Callable[[], Awaitable[ResultT]],
    ) -> ResultT:
        """带幂等键就只执行一次。

        Args: endpoint, model, action。
        """
        return await self.idempotency.run_once(
            endpoint=endpoint,
            key=self.idempotency_key,
            caller=self.caller.user_id,
            model=model,
            action=action,
        )


def _write_context(
    container: Container,
    caller: CallerContext,
    idempotency_key: str | None,
) -> WriteContext:
    return WriteContext(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
        bus=container.command_bus,
        plans=container.plan_notifier,
    )


def get_manage_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(COLLECT_MANAGE))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteContext:
    """增删改数据源与点位用的写上下文。

    Args: container, caller, idempotency_key。
    """
    return _write_context(container, caller, idempotency_key)


def get_operate_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(COLLECT_OPERATE))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteContext:
    """触碰现场设备的动作用的写上下文。

    Args: container, caller, idempotency_key。
    """
    return _write_context(container, caller, idempotency_key)


def get_write_value_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(COLLECT_OPERATE))],
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> WriteContext:
    """下发写值专用：幂等键**必填**。

    Args: container, caller, idempotency_key。
    """
    return _write_context(container, caller, idempotency_key)
