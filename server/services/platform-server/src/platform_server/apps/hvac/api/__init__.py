"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from platform_server.apps.hvac.api import ac_units, rooms, workshops

ROUTERS: tuple[APIRouter, ...] = (
    workshops.router,
    rooms.router,
    ac_units.router,
)

__all__ = ["ROUTERS"]
