"""空调面自己的依赖注入件。

组合根、事务与闸 2 是服务级公共件，在 `platform_server.deps` 里；本模块只补
空调面自己的分片投递、外库读侧、会话表与写值口。
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import BackgroundTasks, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.stream import StreamGroup, StreamLike
from platform_server.apps.hvac.catalog import AC_MANAGE
from platform_server.apps.hvac.services.ac_dispatch import (
    SHARD,
    TRAINING,
    AcDispatchWorker,
)
from platform_server.apps.hvac.services.ac_model_queue import TrainMessage
from platform_server.apps.hvac.services.ac_model_service import (
    dispatch_training,
)
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_service import (
    ShardDispatch,
    dispatch_shards,
)
from platform_server.apps.hvac.services.sessions import Sessions
from platform_server.container import Container
from platform_server.deps import (
    WriteGate,
    get_caller,
    get_container,
    get_idempotency_key,
    get_session,
    require,
)
from platform_server.opcua import NodeWriter

__all__ = [
    "Dispatcher",
    "WriteGate",
    "get_ac_source_reader",
    "get_caller",
    "get_container",
    "get_dispatcher",
    "get_manage_gate",
    "get_node_writer",
    "get_session",
    "get_sessions",
    "require",
]


@dataclass(frozen=True)
class Dispatcher:
    """把分片任务交出去的那只手。

    请求事务在发送响应前完成，后台投递用独立会话读取已提交的批次。
    `ac_startup_service.request_rebuild` 管理自身的重建事务。
    """

    stream: StreamLike
    target: StreamGroup
    model_target: StreamGroup
    database: Sessions
    tasks: BackgroundTasks

    def after_commit(self, plan: ShardDispatch) -> None:
        """排一次提交后的分片投递。

        Args: plan。
        """
        self.tasks.add_task(
            dispatch_shards,
            self.stream,
            self.database,
            target=self.target,
            plan=plan,
        )

    def after_commit_training(self, message: TrainMessage) -> None:
        """排一次提交后的训练投递。

        Args: message。
        """
        self.tasks.add_task(
            dispatch_training,
            self.stream,
            self.database,
            target=self.model_target,
            message=message,
        )


def get_sessions(
    container: Annotated[Container, Depends(get_container)],
) -> Sessions:
    """开短事务的那一面。预测下发要开三个互不相干的短事务，不能借请求那条。

    ⚠ 测试用 `dependency_overrides` 换成用例那条回滚事务。

    Args: container。
    """
    return container.database


def get_dispatcher(
    container: Annotated[Container, Depends(get_container)],
    tasks: BackgroundTasks,
    sessions: Annotated[Sessions, Depends(get_sessions)],
) -> Dispatcher:
    """装出提交后投递用的那只手。测试用 `dependency_overrides` 换成假件。

    Args: container, tasks, sessions。
    """
    settings = container.settings
    return Dispatcher(
        stream=container.stream,
        target=StreamGroup(
            stream=settings.acstartup_stream,
            group=settings.acstartup_group,
            consumer=settings.app_instance,
        ),
        model_target=StreamGroup(
            stream=settings.acmodel_stream,
            group=settings.acmodel_group,
            consumer=settings.app_instance,
        ),
        database=sessions,
        tasks=tasks,
    )


def get_ac_source_reader(
    container: Annotated[Container, Depends(get_container)],
) -> AcSourceReader:
    """外部只读库的读取面。测试用 `dependency_overrides` 换成假件。

    Args: container。
    """
    return AcSourceReader(
        source=container.ac_source,
        timezone=container.settings.acsource_timezone,
    )


def get_hvac_timezone(
    container: Annotated[Container, Depends(get_container)],
) -> str:
    return container.settings.acsource_timezone


def get_node_writer(
    container: Annotated[Container, Depends(get_container)],
) -> NodeWriter:
    """opcua-server 的下发面。测试用 `dependency_overrides` 换成假件。

    Args: container。
    """
    return container.nodes


def get_manage_gate(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(AC_MANAGE))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WriteGate:
    """长任务入口用的写上下文：`ac:manage` 身份 + 可选的幂等键。

    Args: container, caller, idempotency_key, session。
    """
    return WriteGate(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
        receipt_session=session,
    )


def build_ac_dispatcher(container: Container) -> AcDispatchWorker:
    """装配 HVAC 待投递任务的补投循环。Args: container。"""
    settings = container.settings
    return AcDispatchWorker(
        container.database,
        container.stream,
        {TRAINING: settings.acmodel_stream, SHARD: settings.acstartup_stream},
    )
