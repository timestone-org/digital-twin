"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from platform_server.apps.runtime_params.api import runtime_params

ROUTERS: tuple[APIRouter, ...] = (runtime_params.router,)

__all__ = ["ROUTERS"]
