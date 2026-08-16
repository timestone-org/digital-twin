"""采集配置面自己的依赖注入件。

组合根、事务、闸 2 与幂等键是服务级公共件，在 `platform_server.deps` 里；
本模块只补数据源出参要的旁路信息与三档写上下文。
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends

from lib.auth import CallerContext
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
from platform_server.container import Container
from platform_server.deps import (
    WriteGate,
    get_caller,
    get_container,
    get_idempotency_key,
    get_session,
    require,
    require_service_key,
)

__all__ = [
    "WriteContext",
    "get_caller",
    "get_container",
    "get_idempotency_key",
    "get_manage_context",
    "get_operate_context",
    "get_session",
    "get_source_context",
    "get_write_value_context",
    "require",
    "require_idempotency_key",
    "require_service_key",
]


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


@dataclass(frozen=True)
class WriteContext(WriteGate):
    """一次写请求要的全套：幂等键、调用者、命令总线与计划广播口。"""

    bus: CommandBus
    plans: PlanNotifier


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
