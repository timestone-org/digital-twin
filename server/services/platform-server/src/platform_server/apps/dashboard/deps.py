"""大屏组态面自己的依赖注入件。

组合根、事务、闸 2 与幂等键是服务级公共件，在 `platform_server.deps` 里；
本模块只补大屏面自己的校验依据与两档写上下文。
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends

from lib.auth import CallerContext
from platform_server.apps.dashboard.catalog import (
    DASHBOARD_EDIT,
    DASHBOARD_MANAGE,
)
from platform_server.apps.dashboard.services import ValidationContext
from platform_server.container import Container
from platform_server.deps import (
    WriteGate,
    get_caller,
    get_container,
    get_idempotency_key,
    get_session,
    require,
)

__all__ = [
    "WriteContext",
    "get_caller",
    "get_container",
    "get_edit_context",
    "get_idempotency_key",
    "get_manage_context",
    "get_session",
    "get_validation_context",
    "require",
]


def get_validation_context(
    container: Annotated[Container, Depends(get_container)],
) -> ValidationContext:
    """校验要问的两件外部事实。测试用 `dependency_overrides` 换成假件。

    Args: container。
    """
    return ValidationContext(
        catalog=container.module_catalog, points=container.points
    )


@dataclass(frozen=True)
class WriteContext(WriteGate):
    """一次写请求要的全套：幂等键、调用者与校验依据。"""

    validation: ValidationContext


def get_edit_context(
    container: Annotated[Container, Depends(get_container)],
    validation: Annotated[ValidationContext, Depends(get_validation_context)],
    caller: Annotated[CallerContext, Depends(require(DASHBOARD_EDIT))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteContext:
    """改大屏内容用的写上下文。

    Args: container, validation, caller, idempotency_key。
    """
    return WriteContext(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
        validation=validation,
    )


def get_manage_context(
    container: Annotated[Container, Depends(get_container)],
    validation: Annotated[ValidationContext, Depends(get_validation_context)],
    caller: Annotated[CallerContext, Depends(require(DASHBOARD_MANAGE))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteContext:
    """建删项目与大屏用的写上下文。

    Args: container, validation, caller, idempotency_key。
    """
    return WriteContext(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
        validation=validation,
    )
