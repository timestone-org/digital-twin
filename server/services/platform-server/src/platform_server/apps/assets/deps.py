"""素材面自己的依赖注入件。

组合根、事务与闸 2 是服务级公共件，在 `platform_server.deps` 里，本模块只把
它们转手给路由，另外给出素材面自己要的对象存储客户端。
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import BackgroundTasks, Depends

from lib.db import Database
from lib.objectstore import ObjectStore
from platform_server.apps.assets.services.compress_queue import (
    CompressMessage,
    dispatch_compression,
)
from platform_server.container import Container
from platform_server.deps import (
    get_caller,
    get_container,
    get_session,
    require,
)
from platform_server.stream import StreamGroup, StreamLike

__all__ = [
    "CompressDispatcher",
    "get_caller",
    "get_compress_dispatcher",
    "get_container",
    "get_object_store",
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


@dataclass(frozen=True)
class CompressDispatcher:
    """提交后投压缩任务用的那只手。

    ⚠ 走 `BackgroundTasks` 而不是在处理函数里直接投：请求的事务在依赖退出时
    才提交，处理函数里投出去的话，worker 可能先于提交读到——那时素材行还不
    存在，它只能把这条当成「素材已删」丢掉，而字节其实好好地躺在桶里。
    """

    stream: StreamLike
    target: StreamGroup
    database: Database
    tasks: BackgroundTasks

    def after_commit(self, message: CompressMessage) -> None:
        """排一次提交后的压缩投递。

        Args: message。
        """
        self.tasks.add_task(
            dispatch_compression,
            self.stream,
            target=self.target,
            message=message,
        )


def get_compress_dispatcher(
    container: Annotated[Container, Depends(get_container)],
    tasks: BackgroundTasks,
) -> CompressDispatcher:
    """装出提交后投递用的那只手。测试用 `dependency_overrides` 换成假件。

    Args: container, tasks。
    """
    settings = container.settings
    return CompressDispatcher(
        stream=container.stream,
        target=StreamGroup(
            stream=settings.assetcompress_stream,
            group=settings.assetcompress_group,
            consumer=settings.app_instance,
        ),
        database=container.database,
        tasks=tasks,
    )
