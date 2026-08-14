"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from platform_server.apps.collect.api import (
    collect_points,
    collect_sources,
    internal,
    point_histories,
)

ROUTERS: tuple[APIRouter, ...] = (
    collect_sources.router,
    collect_points.router,
    point_histories.router,
    # ⚠ 内部面挂在 `/internal/v1/`，走服务级密钥而不是权限码：它要挡的是
    # 「任何人」，而权限码挂在人身上（ADR-0005）
    internal.router,
)

__all__ = ["ROUTERS"]
