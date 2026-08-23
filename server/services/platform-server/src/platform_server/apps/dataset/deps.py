"""台账面自己的依赖注入件。

组合根、事务、闸 2 与幂等键是服务级公共件，在 `platform_server.deps` 里；
本模块只补一个带写权限判定的写上下文。
"""

from typing import Annotated

from fastapi import Depends

from lib.auth import CallerContext
from platform_server.apps.dataset.catalog import DATASET_MANAGE
from platform_server.container import Container
from platform_server.deps import (
    WriteGate,
    get_container,
    get_idempotency_key,
    get_session,
    require,
)

__all__ = [
    "WriteGate",
    "get_container",
    "get_idempotency_key",
    "get_manage_context",
    "get_session",
    "require",
]


def get_manage_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(DATASET_MANAGE))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteGate:
    """增删改台账与列用的写上下文。

    ⚠ 直接用 `WriteGate` 而不另立子类：台账面不碰现场设备、也不广播采集计划，
    没有第三个协作者要带，空子类只是一层没有内容的间接。
    Args: container, caller, idempotency_key。
    """
    return WriteGate(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
    )
