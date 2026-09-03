"""HTTP 路由。业务不写在这里，路由函数只做取参 → 调 service → 包封。"""

from fastapi import APIRouter

from platform_server.apps.llm_providers.api import (
    internal,
    llm_credentials,
    llm_provider_kinds,
    llm_providers,
    llm_purposes,
)

ROUTERS: tuple[APIRouter, ...] = (
    llm_provider_kinds.router,
    llm_providers.router,
    llm_credentials.router,
    llm_purposes.router,
    internal.router,
)

__all__ = ["ROUTERS"]
