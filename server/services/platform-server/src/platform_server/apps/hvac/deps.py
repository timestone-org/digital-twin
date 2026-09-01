"""空调面自己的依赖注入件。

组合根、事务与闸 2 是服务级公共件，在 `platform_server.deps` 里；本模块只补
空调面自己的分片投递、外库读侧、会话表与写值口。
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import BackgroundTasks, Depends

from lib.db import Database
from lib.stream import StreamGroup, StreamLike
from platform_server.apps.hvac.services.ac_model_queue import TrainMessage
from platform_server.apps.hvac.services.ac_model_service import (
    dispatch_training,
)
from platform_server.apps.hvac.services.ac_publish_service import Sessions
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_service import (
    ShardDispatch,
    dispatch_shards,
)
from platform_server.container import Container
from platform_server.deps import (
    get_caller,
    get_container,
    get_session,
    require,
)
from platform_server.opcua import NodeWriter

__all__ = [
    "Dispatcher",
    "get_ac_source_reader",
    "get_caller",
    "get_container",
    "get_dispatcher",
    "get_node_writer",
    "get_session",
    "get_sessions",
    "require",
]


@dataclass(frozen=True)
class Dispatcher:
    """把分片任务交出去的那只手。

    ⚠ **后台任务并不跑在事务提交之后**：FastAPI 把「发响应」放在 yield 依赖的
    退出栈里面，而 `Response.__call__` 发完响应就地 await 后台任务——于是投递
    排在 `get_session` 提交之前。批次行因此必须由
    `ac_startup_service.request_rebuild` 自己提交，本类不承担落盘时机。
    """

    stream: StreamLike
    target: StreamGroup
    model_target: StreamGroup
    database: Database
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


def get_dispatcher(
    container: Annotated[Container, Depends(get_container)],
    tasks: BackgroundTasks,
) -> Dispatcher:
    """装出提交后投递用的那只手。测试用 `dependency_overrides` 换成假件。

    Args: container, tasks。
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
        database=container.database,
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


def get_sessions(
    container: Annotated[Container, Depends(get_container)],
) -> Sessions:
    """开短事务的那一面。预测下发要开三个互不相干的短事务，不能借请求那条。

    ⚠ 测试用 `dependency_overrides` 换成用例那条回滚事务。

    Args: container。
    """
    return container.database


def get_node_writer(
    container: Annotated[Container, Depends(get_container)],
) -> NodeWriter:
    """opcua-server 的下发面。测试用 `dependency_overrides` 换成假件。

    Args: container。
    """
    return container.nodes
