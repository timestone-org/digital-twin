"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from platform_server.apps.modeling.api import (
    modeling_models,
    modeling_operators,
    modeling_pipelines,
    modeling_runs,
)

ROUTERS: tuple[APIRouter, ...] = (
    modeling_operators.router,
    modeling_pipelines.router,
    modeling_runs.router,
    modeling_models.versions,
    modeling_models.bindings,
)

__all__ = ["ROUTERS"]
