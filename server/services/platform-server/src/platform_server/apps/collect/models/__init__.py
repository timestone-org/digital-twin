"""ORM 模型。只描述表，业务规则不写在这里。"""

from platform_server.apps.collect.models.base import Base
from platform_server.apps.collect.models.point import CollectPoint
from platform_server.apps.collect.models.source import (
    MIN_INTERVAL_MS,
    CollectSource,
)

__all__ = [
    "MIN_INTERVAL_MS",
    "Base",
    "CollectPoint",
    "CollectSource",
]
