"""建模面自己的依赖注入件。

组合根、事务、闸 2 与幂等键是服务级公共件，在 `platform_server.deps` 里；
本模块只补几个带写权限判定的写上下文。
"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends

from lib.auth import CallerContext
from lib.objectstore import ObjectStore
from lib.stream import StreamGroup
from platform_server.apps.modeling.catalog import (
    MODELING_MANAGE,
    MODELING_PUBLISH,
    MODELING_RUN,
)
from platform_server.apps.modeling.services import Actor, RunContext
from platform_server.apps.modeling.services.open_model_service import (
    OpenModelDeps,
)
from platform_server.apps.modeling.services.sessions import Sessions
from platform_server.container import Container
from platform_server.deps import (
    WriteGate,
    get_container,
    get_idempotency_key,
    get_session,
    require,
)

__all__ = [
    "OpenModelDeps",
    "WriteGate",
    "get_container",
    "get_idempotency_key",
    "get_manage_context",
    "get_modeling_sessions",
    "get_object_store",
    "get_open_model_deps",
    "get_publish_context",
    "get_run_context",
    "get_session",
    "require",
]


def get_object_store(
    container: Annotated[Container, Depends(get_container)],
) -> ObjectStore:
    """取对象存储客户端。进程内共用一个，构造在组合根。

    Args: container。
    """
    return container.object_store


def get_modeling_sessions(
    container: Annotated[Container, Depends(get_container)],
) -> Sessions:
    """开短事务的那一面。调用记录要走自己的事务，不能借请求那条。

    ⚠ 用例用 `dependency_overrides` 把它换成那条回滚事务的会话工厂——不换的话
    另开一条连接看不见用例种下的数据，而现象是「记录说部署不存在」。
    Args: container。
    """
    return container.database


def get_open_model_deps(
    container: Annotated[Container, Depends(get_container)],
    sessions: Annotated[Sessions, Depends(get_modeling_sessions)],
) -> OpenModelDeps:
    """对外推理面要的那几样。

    ⚠ 产物缓存挂在**容器**上而不是每次请求新造一个：每次新造的表现是每一次
    调用都把模型重新反序列化一遍，而那是这条路径上最贵的一步。
    Args: container, sessions。
    """
    return OpenModelDeps(
        cache=container.cache,
        sessions=sessions,
        store=container.object_store,
        artifacts=container.modeling_artifacts,
    )


def get_manage_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(MODELING_MANAGE))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteGate:
    """建改删流水线、校验、导入用的写上下文。

    Args: container, caller, idempotency_key。
    """
    return WriteGate(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
    )


def get_publish_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(MODELING_PUBLISH))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteGate:
    """发布模型版本与建改删绑定用的写上下文。

    ⚠ 与 `manage` 分成两个码：绑定生效后，引用那条公式的每一张台账的数值都会
    跟着模型走（docs/MODELING_DESIGN.md §9.1）。
    Args: container, caller, idempotency_key。
    """
    return WriteGate(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
    )


def get_run_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(MODELING_RUN))],
) -> RunContext:
    """发起 / 取消运行用的上下文，连同投队列要的那条流。

    ⚠ 只带「往哪儿投」，不带「怎么跑」：执行整个在 worker 角色里，API 这边
    连时区都不需要知道。
    Args: container, caller。
    """
    settings = container.settings
    return RunContext(
        actor=Actor(user_id=str(caller.user_id), name=caller.username),
        stream=container.stream,
        target=StreamGroup(
            stream=settings.modeling_stream,
            group=settings.modeling_group,
            consumer=settings.app_instance,
        ),
        now=datetime.now(UTC),
    )
