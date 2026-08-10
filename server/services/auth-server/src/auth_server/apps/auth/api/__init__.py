"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from auth_server.apps.auth.api import (
    internal,
    permissions,
    roles,
    route_rules,
    sessions,
    users,
)

ROUTERS: tuple[APIRouter, ...] = (
    sessions.router,
    users.router,
    roles.router,
    permissions.router,
    route_rules.router,
    internal.router,
)

__all__ = ["ROUTERS"]
