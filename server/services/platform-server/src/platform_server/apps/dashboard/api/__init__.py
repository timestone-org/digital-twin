"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from platform_server.apps.dashboard.api import (
    dashboard_bindings,
    dashboard_nodes,
    dashboard_projects,
    dashboards,
    module_types,
)

ROUTERS: tuple[APIRouter, ...] = (
    dashboard_projects.router,
    dashboards.router,
    dashboard_nodes.router,
    dashboard_bindings.router,
    module_types.router,
)

__all__ = ["ROUTERS"]
