"""运行参数面自己的依赖注入件。

组合根、事务与闸 2 是服务级公共件，在 `platform_server.deps` 里，本模块只把
它们转手给路由，另外给出取配置对象的那一件。
"""

from typing import Annotated

from fastapi import Depends

from platform_server.container import Container
from platform_server.deps import (
    get_caller,
    get_container,
    get_session,
    require,
)
from platform_server.settings import Settings

__all__ = [
    "get_caller",
    "get_container",
    "get_session",
    "get_settings",
    "require",
]


def get_settings(
    container: Annotated[Container, Depends(get_container)],
) -> Settings:
    """取本进程的配置对象。

    ⚠ 运行参数的默认值每次都从它现取：环境变量是永久默认值，不是启动时抄进
    表里的一次性播种。
    Args: container。
    """
    return container.settings
