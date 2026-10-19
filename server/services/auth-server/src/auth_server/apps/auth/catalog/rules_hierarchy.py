"""层级图闸 1 规则，与服务端逐路由契约验证。"""

from auth_server.apps.auth.catalog.permissions import (
    HIERARCHY_MANAGE,
    HIERARCHY_VIEW,
)
from auth_server.apps.auth.catalog.specs import RouteRuleSpec

PREFIX: str = "/api/v1/hierarchy"
HIERARCHY_RULES: tuple[RouteRuleSpec, ...] = (
    *(
        RouteRuleSpec(
            f"{PREFIX}/{path}",
            "GET",
            priority=999,
            description="层级图探针与契约",
        )
        for path in ("health", "ready", "docs", "redoc", "openapi.json")
    ),
    RouteRuleSpec(
        f"{PREFIX}/capabilities",
        "GET",
        codes=(HIERARCHY_VIEW,),
        priority=900,
        description="层级图能力",
    ),
    RouteRuleSpec(
        f"{PREFIX}/projects*",
        "GET",
        codes=(HIERARCHY_VIEW,),
        priority=890,
        description="层级图读取",
    ),
    RouteRuleSpec(
        f"{PREFIX}/projects*",
        "*",
        codes=(HIERARCHY_MANAGE,),
        priority=880,
        description="层级图管理",
    ),
)
