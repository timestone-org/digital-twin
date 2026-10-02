"""素材面自己的依赖注入件。

组合根、事务与闸 2 是服务级公共件，在 `platform_server.deps` 里，本模块只把
它们转手给路由，另外给出素材面自己要的对象存储客户端。
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import BackgroundTasks, Depends

from lib.db import Database
from lib.stream import StreamGroup, StreamLike
from platform_server.apps.assets.services.compress_queue import (
    CompressMessage,
    dispatch_compression,
)
from platform_server.apps.assets.services.replacement import Sessions
from platform_server.container import Container
from platform_server.deps import (
    get_caller,
    get_container,
    get_object_store,
    get_session,
    get_stream,
    require,
)

__all__ = [
    "CompressDispatcher",
    "get_caller",
    "get_compress_dispatcher",
    "get_container",
    "get_object_store",
    "get_session",
    "require",
]


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
    stream: Annotated[StreamLike, Depends(get_stream)],
) -> CompressDispatcher:
    """装出提交后投递用的那只手。测试用 `dependency_overrides` 换成假件。

    Args: container, tasks, stream。
    """
    settings = container.settings
    return CompressDispatcher(
        stream=stream,
        target=StreamGroup(
            stream=settings.assetcompress_stream,
            group=settings.assetcompress_group,
            consumer=settings.app_instance,
        ),
        database=container.database,
        tasks=tasks,
    )


def get_asset_sessions(
    container: Annotated[Container, Depends(get_container)],
) -> Sessions:
    """模型替换的短事务入口。Args: container。"""
    return container.database


def get_asset_public_base(
    container: Annotated[Container, Depends(get_container)],
) -> str:
    """浏览器可访问的对象存储前缀。Args: container。"""
    return container.settings.objectstore_public_base
