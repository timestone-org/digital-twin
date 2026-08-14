"""数据访问层。只做查询与挂载实体，**不提交**——事务边界归 service 层。"""

from platform_server.apps.dashboard.crud import publish as publish_crud
from platform_server.apps.dashboard.crud.binding import (
    BindingCrud,
    binding_crud,
)
from platform_server.apps.dashboard.crud.dashboard import (
    DashboardCrud,
    dashboard_crud,
)
from platform_server.apps.dashboard.crud.node import NodeCrud, node_crud
from platform_server.apps.dashboard.crud.project import (
    ProjectCrud,
    project_crud,
)

__all__ = [
    "BindingCrud",
    "DashboardCrud",
    "NodeCrud",
    "ProjectCrud",
    "binding_crud",
    "dashboard_crud",
    "node_crud",
    "project_crud",
    "publish_crud",
]
