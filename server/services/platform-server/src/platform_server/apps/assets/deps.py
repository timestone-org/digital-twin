"""素材面自己的依赖注入件。

组合根、事务与闸 2 是服务级公共件，在 `platform_server.deps` 里，本模块只把
它们转手给路由，另外给出素材面自己要的对象存储客户端。
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import after_commit
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
    """投压缩任务用的那只手。

    ⚠ 请求事务要到依赖退出时才提交，而 `BackgroundTasks` 跑在响应里，比提交
    早。提交前投出去的话，worker 读到的还是旧库：素材行不存在就当成已删，
    各档还是 `ready` 就全部跳过，而消息已被确认，那几档永远停在 `pending`。
    """

    stream: StreamLike
    target: StreamGroup

    def after_commit(
        self, session: AsyncSession, message: CompressMessage
    ) -> None:
        """登记一次提交后的压缩投递。

        Args: session（持有这次写的请求事务）, message。
        """
        after_commit(session, lambda: self.dispatch(message))

    async def dispatch(self, message: CompressMessage) -> None:
        """立刻投递。只给事务已经提交的调用方用。

        Args: message。
        """
        await dispatch_compression(
            self.stream, target=self.target, message=message
        )


def get_compress_dispatcher(
    container: Annotated[Container, Depends(get_container)],
    stream: Annotated[StreamLike, Depends(get_stream)],
) -> CompressDispatcher:
    """装出投压缩任务用的那只手。测试用 `dependency_overrides` 换成假件。

    Args: container, stream。
    """
    settings = container.settings
    return CompressDispatcher(
        stream=stream,
        target=StreamGroup(
            stream=settings.assetcompress_stream,
            group=settings.assetcompress_group,
            consumer=settings.app_instance,
        ),
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
