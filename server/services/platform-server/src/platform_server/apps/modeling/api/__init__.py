"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from platform_server.apps.modeling.api import (
    modeling_deployments,
    modeling_models,
    modeling_operators,
    modeling_pipelines,
    modeling_runs,
    open_models,
)

ROUTERS: tuple[APIRouter, ...] = (
    modeling_operators.router,
    modeling_pipelines.router,
    modeling_runs.router,
    modeling_models.versions,
    modeling_models.bindings,
    modeling_deployments.deployments,
    # ⚠ 这一条是**匿名可达**的，见 `open_models.py` 的模块注释
    open_models.open_models,
)

__all__ = ["ROUTERS"]
