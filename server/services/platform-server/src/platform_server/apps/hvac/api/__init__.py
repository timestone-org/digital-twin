"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from platform_server.apps.hvac.api import (
    ac_data,
    ac_startups,
    ac_units,
    rooms,
    workshops,
)

ROUTERS: tuple[APIRouter, ...] = (
    workshops.router,
    rooms.router,
    ac_units.router,
    ac_data.router,
    ac_startups.router,
)

__all__ = ["ROUTERS"]
