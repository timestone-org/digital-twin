"""闸 1 对 `/api/v1/auth` 的规则。

⚠ 本段**故意不设 catch-all**：未枚举的路径落到「受管前缀无规则 = 拒绝」。
"""

from auth_server.apps.auth.catalog.permissions import (
    ROLE_MANAGE,
    ROUTE_RULE_MANAGE,
    ROUTE_RULE_VIEW,
    USER_DELETE,
    USER_GRANT,
    USER_MANAGE,
    USER_VIEW,
)
from auth_server.apps.auth.catalog.specs import RouteRuleSpec

_P = "/api/v1/auth"

AUTH_RULES: tuple[RouteRuleSpec, ...] = (
    RouteRuleSpec(f"{_P}/health", "GET", priority=999, description="存活探针"),
    RouteRuleSpec(f"{_P}/ready", "GET", priority=999, description="就绪探针"),
    RouteRuleSpec(f"{_P}/docs", "GET", priority=998, description="文档"),
    RouteRuleSpec(f"{_P}/redoc", "GET", priority=998, description="文档"),
    RouteRuleSpec(
        f"{_P}/openapi.json", "GET", priority=998, description="契约"
    ),
    RouteRuleSpec(
        f"{_P}/sessions*",
        "*",
        priority=995,
        description="登录/刷新/登出。⚠ 匿名可达性由边缘免认证 location 保证",
    ),
    RouteRuleSpec(
        f"{_P}/registrations",
        "POST",
        priority=994,
        description="自助注册。⚠ 同上，需边缘免认证 location",
    ),
    RouteRuleSpec(
        f"{_P}/users/me*",
        "*",
        priority=992,
        description="个人资料自服务，任意登录用户，不要求权限码",
    ),
    RouteRuleSpec(
        f"{_P}/users/*:assign-role",
        "POST",
        codes=(USER_GRANT,),
        priority=971,
        description="改派角色",
    ),
    RouteRuleSpec(
        f"{_P}/users/*/permissions",
        "PUT",
        codes=(USER_GRANT,),
        priority=971,
        description="覆盖式写用户直权",
    ),
    RouteRuleSpec(
        f"{_P}/users*",
        "GET",
        codes=(USER_VIEW,),
        priority=965,
        description="用户列表与详情",
    ),
    RouteRuleSpec(
        f"{_P}/users",
        "POST",
        codes=(USER_MANAGE,),
        priority=965,
        description="创建用户",
    ),
    RouteRuleSpec(
        f"{_P}/users/*",
        "POST",
        codes=(USER_MANAGE,),
        priority=963,
        description="启停、重置他人密码",
    ),
    RouteRuleSpec(
        f"{_P}/users/*",
        "PATCH",
        codes=(USER_MANAGE,),
        priority=960,
        description="更新他人资料",
    ),
    RouteRuleSpec(
        f"{_P}/users/*",
        "DELETE",
        codes=(USER_DELETE,),
        priority=960,
        description="删除用户",
    ),
    RouteRuleSpec(
        f"{_P}/roles*",
        "GET",
        codes=(USER_VIEW,),
        priority=955,
        description="角色列表与详情",
    ),
    RouteRuleSpec(
        f"{_P}/roles*",
        "POST",
        codes=(ROLE_MANAGE,),
        priority=955,
        description="建角色",
    ),
    RouteRuleSpec(
        f"{_P}/roles*",
        "PATCH",
        codes=(ROLE_MANAGE,),
        priority=955,
        description="改角色",
    ),
    RouteRuleSpec(
        f"{_P}/roles*",
        "PUT",
        codes=(ROLE_MANAGE,),
        priority=955,
        description="覆盖式设置角色权限",
    ),
    RouteRuleSpec(
        f"{_P}/roles*",
        "DELETE",
        codes=(ROLE_MANAGE,),
        priority=955,
        description="删角色",
    ),
    RouteRuleSpec(
        f"{_P}/permissions*",
        "GET",
        codes=(USER_VIEW, ROLE_MANAGE),
        match_mode="any",
        priority=945,
        description="权限目录只读。配角色的人不一定有用户面的读码",
    ),
    RouteRuleSpec(
        f"{_P}/route-rules*",
        "GET",
        codes=(ROUTE_RULE_VIEW,),
        priority=925,
        description="规则列表与详情",
    ),
    RouteRuleSpec(
        f"{_P}/route-rules*",
        "POST",
        codes=(ROUTE_RULE_MANAGE,),
        priority=925,
        description="新增规则",
    ),
    RouteRuleSpec(
        f"{_P}/route-rules*",
        "PATCH",
        codes=(ROUTE_RULE_MANAGE,),
        priority=925,
        description="修改规则",
    ),
    RouteRuleSpec(
        f"{_P}/route-rules*",
        "DELETE",
        codes=(ROUTE_RULE_MANAGE,),
        priority=925,
        description="删除规则",
    ),
)
