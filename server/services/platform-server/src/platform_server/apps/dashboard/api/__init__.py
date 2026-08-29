"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from platform_server.apps.dashboard.api import (
    card_styles,
    dashboard_bindings,
    dashboard_nodes,
    dashboard_projects,
    dashboard_share,
    dashboard_templates,
    dashboard_thumbnails,
    dashboard_transfer,
    dashboards,
    module_types,
    project_themes,
    public_dashboards,
)

ROUTERS: tuple[APIRouter, ...] = (
    dashboard_projects.router,
    project_themes.router,
    dashboards.router,
    dashboard_transfer.router,
    dashboard_share.router,
    dashboard_thumbnails.router,
    dashboard_nodes.router,
    dashboard_bindings.router,
    dashboard_templates.router,
    card_styles.router,
    module_types.router,
    # ⚠ 公开面排在最后且单独一条：它是本服务唯一不带鉴权的路由，
    # 混进上面那串会让「哪些路径匿名可达」在评审时看不出来
    public_dashboards.router,
)

__all__ = ["ROUTERS"]
