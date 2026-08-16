"""素材面自己的依赖注入件。

组合根、事务与闸 2 是服务级公共件，在 `platform_server.deps` 里，本模块只把
它们转手给路由，另外给出素材面自己要的对象存储客户端。
"""

from typing import Annotated

from fastapi import Depends

from lib.objectstore import ObjectStore
from platform_server.container import Container
from platform_server.deps import (
    get_caller,
    get_container,
    get_session,
    require,
)

__all__ = [
    "get_caller",
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
