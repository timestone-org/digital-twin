"""大屏组态面的入参与出参。ORM 模型绝不直接返给 HTTP 层。"""

from platform_server.apps.dashboard.schemas.binding import (
    BindingCreateIn,
    BindingOut,
    BindingUpdateIn,
)
from platform_server.apps.dashboard.schemas.dashboard import (
    DashboardCreateIn,
    DashboardOut,
    DashboardSummaryOut,
    DashboardUpdateIn,
    LayoutIssueOut,
    ReplaceLayoutIn,
    ValidationReportOut,
)
from platform_server.apps.dashboard.schemas.module_type import (
    ModuleCatalogOut,
    ModuleTypeDetailOut,
    ModuleTypeOut,
)
from platform_server.apps.dashboard.schemas.node import (
    LayoutNodeIn,
    NodeCreateIn,
    NodeOut,
    NodeUpdateIn,
)
from platform_server.apps.dashboard.schemas.project import (
    ProjectCreateIn,
    ProjectOut,
    ProjectUpdateIn,
)

__all__ = [
    "BindingCreateIn",
    "BindingOut",
    "BindingUpdateIn",
    "DashboardCreateIn",
    "DashboardOut",
    "DashboardSummaryOut",
    "DashboardUpdateIn",
    "LayoutIssueOut",
    "LayoutNodeIn",
    "ModuleCatalogOut",
    "ModuleTypeDetailOut",
    "ModuleTypeOut",
    "NodeCreateIn",
    "NodeOut",
    "NodeUpdateIn",
    "ProjectCreateIn",
    "ProjectOut",
    "ProjectUpdateIn",
    "ReplaceLayoutIn",
    "ValidationReportOut",
]
