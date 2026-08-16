"""大屏组态的业务层，也是本模块对外的公开面。

事务边界在这一层：crud 不提交，api 不写业务。

⚠ **发布面（`publish_service`）刻意不进这份清单**：它要读 `apps/collect` 的
快照公开面，而 `apps/collect` 的公开面又要读本模块的 `point_usage`（删点位
前问大屏绑定）。两份 `__init__` 互相 import 就是一个 **import 期的环**，表现是
「partially initialized module」而不是任何业务错误。两个方向都是真实的领域依赖，
删不掉；出路是让其中一份清单不参与，故发布面的消费方（组合根与 publisher 角色）
按子模块精确 import。
"""

from platform_server.apps.dashboard.services import (
    binding_service,
    dashboard_service,
    layout_service,
    node_service,
    project_service,
)
from platform_server.apps.dashboard.services.idempotency import (
    IdempotencyStore,
)
from platform_server.apps.dashboard.services.module_catalog import (
    ModuleCatalog,
    load_module_catalog,
)
from platform_server.apps.dashboard.services.point_catalog import (
    PointCatalog,
    StaticPointCatalog,
)
from platform_server.apps.dashboard.services.point_usage import (
    BoundDashboard,
    dashboards_binding,
)
from platform_server.apps.dashboard.services.topic_reconcile import (
    TopicReconciler,
)
from platform_server.apps.dashboard.services.validation import (
    ValidationContext,
)
from platform_server.apps.dashboard.services.viewers import (
    SUBSCRIPTION_SCHEMA,
    ReadOnlyViewerSource,
    SubscriptionViewers,
    ViewerSource,
)

__all__ = [
    "SUBSCRIPTION_SCHEMA",
    "BoundDashboard",
    "IdempotencyStore",
    "ModuleCatalog",
    "PointCatalog",
    "ReadOnlyViewerSource",
    "StaticPointCatalog",
    "SubscriptionViewers",
    "TopicReconciler",
    "ValidationContext",
    "ViewerSource",
    "binding_service",
    "dashboard_service",
    "dashboards_binding",
    "layout_service",
    "load_module_catalog",
    "node_service",
    "project_service",
]
