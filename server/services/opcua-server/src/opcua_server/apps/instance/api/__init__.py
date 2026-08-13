"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from opcua_server.apps.instance.api import instances, nodes, security

ROUTERS: tuple[APIRouter, ...] = (
    instances.router,
    nodes.router,
    security.router,
)

__all__ = ["ROUTERS"]
