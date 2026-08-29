"""大屏组态的全部 ORM 模型。

alembic 的 `env.py` 通过本文件收集元数据，故须维护 `__all__`：漏一个即迁移漏表。
"""

from platform_server.apps.dashboard.models.base import Base
from platform_server.apps.dashboard.models.binding import DashboardBinding
from platform_server.apps.dashboard.models.card_style import CardStyle
from platform_server.apps.dashboard.models.dashboard import Dashboard
from platform_server.apps.dashboard.models.node import DashboardNode
from platform_server.apps.dashboard.models.project import DashboardProject
from platform_server.apps.dashboard.models.template import DashboardTemplate
from platform_server.apps.dashboard.models.thumbnail import DashboardThumbnail

__all__ = [
    "Base",
    "CardStyle",
    "Dashboard",
    "DashboardBinding",
    "DashboardNode",
    "DashboardProject",
    "DashboardTemplate",
    "DashboardThumbnail",
]
