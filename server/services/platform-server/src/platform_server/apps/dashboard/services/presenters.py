"""ORM 模型 → 对外模型。转换只在这一处发生，HTTP 层拿不到 ORM 对象。"""

from collections.abc import Sequence

from platform_server.apps.dashboard.models import (
    Dashboard,
    DashboardBinding,
    DashboardNode,
    DashboardProject,
)
from platform_server.apps.dashboard.schemas import (
    BindingOut,
    DashboardOut,
    DashboardSummaryOut,
    NodeOut,
    ProjectOut,
)


def to_binding_out(binding: DashboardBinding) -> BindingOut:
    """一条绑定的对外形态。

    Args: binding。
    """
    return BindingOut.model_validate(binding)


def to_node_out(
    node: DashboardNode, *, bindings: Sequence[DashboardBinding]
) -> NodeOut:
    """一个节点的对外形态。绑定由调用方按 `(field_key, id)` 备好。

    Args: node, bindings。
    """
    return NodeOut(
        id=node.id,
        dashboard_id=node.dashboard_id,
        parent_id=node.parent_id,
        client_key=node.client_key,
        module_type=node.module_type,
        x_px=node.x_px,
        y_px=node.y_px,
        width_px=node.width_px,
        height_px=node.height_px,
        z_index=node.z_index,
        is_visible=node.is_visible,
        config_json=node.config_json,
        created_at=node.created_at,
        updated_at=node.updated_at,
        bindings=[to_binding_out(item) for item in bindings],
    )


def to_project_out(
    project: DashboardProject, *, dashboard_count: int
) -> ProjectOut:
    """一个项目的对外形态。

    Args: project, dashboard_count。
    """
    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        theme_json=project.theme_json,
        brand_json=project.brand_json,
        dashboard_count=dashboard_count,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def to_dashboard_summary_out(
    dashboard: Dashboard, *, node_count: int
) -> DashboardSummaryOut:
    """列表页的大屏条目。

    Args: dashboard, node_count。
    """
    return DashboardSummaryOut(
        id=dashboard.id,
        project_id=dashboard.project_id,
        name=dashboard.name,
        description=dashboard.description,
        design_width=dashboard.design_width,
        design_height=dashboard.design_height,
        row_version=dashboard.row_version,
        schema_version=dashboard.schema_version,
        is_public=dashboard.is_public,
        node_count=node_count,
        created_at=dashboard.created_at,
        updated_at=dashboard.updated_at,
    )


def to_dashboard_out(
    dashboard: Dashboard, *, nodes: Sequence[NodeOut]
) -> DashboardOut:
    """一张完整的大屏。`nodes` 是扁平数组，树由 `parent_id` 重建。

    Args: dashboard, nodes。
    """
    return DashboardOut(
        id=dashboard.id,
        project_id=dashboard.project_id,
        name=dashboard.name,
        description=dashboard.description,
        design_width=dashboard.design_width,
        design_height=dashboard.design_height,
        row_version=dashboard.row_version,
        schema_version=dashboard.schema_version,
        is_public=dashboard.is_public,
        node_count=len(nodes),
        created_at=dashboard.created_at,
        updated_at=dashboard.updated_at,
        theme_json=dashboard.theme_json,
        chrome_json=dashboard.chrome_json,
        nodes=list(nodes),
    )
