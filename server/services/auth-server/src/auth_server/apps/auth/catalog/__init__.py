"""权限码目录、内置角色与内置路由规则 —— 全系统权限口径的唯一真源。

数据按职责分文件（`permissions` / `roles` / `rules_<服务>`），这里把它们拼成
消费方看到的那三个名字。划分口径与三道闸见 auth-server 的 CONTEXT.md。
"""

from auth_server.apps.auth.catalog.permissions import (
    AC_MANAGE,
    AC_VIEW,
    ALL_CODES,
    ASSET_MANAGE,
    ASSET_VIEW,
    ASSISTANT_USE,
    COLLECT_MANAGE,
    COLLECT_OPERATE,
    COLLECT_VIEW,
    DASHBOARD_EDIT,
    DASHBOARD_MANAGE,
    DASHBOARD_VIEW,
    DATASET_BACKFILL,
    DATASET_MANAGE,
    DATASET_OVERRIDE,
    DATASET_RECORD_WRITE,
    DATASET_VIEW,
    OPCUA_MANAGE,
    OPCUA_OPERATE,
    OPCUA_VIEW,
    PERMISSIONS,
    ROLE_MANAGE,
    ROUTE_RULE_MANAGE,
    ROUTE_RULE_VIEW,
    USER_DELETE,
    USER_GRANT,
    USER_MANAGE,
    USER_VIEW,
    VIEW_CODES,
    grouped_permissions,
)
from auth_server.apps.auth.catalog.roles import ROLE_ADMIN, ROLE_VIEWER, ROLES
from auth_server.apps.auth.catalog.rules_assistant import ASSISTANT_RULES
from auth_server.apps.auth.catalog.rules_auth import AUTH_RULES
from auth_server.apps.auth.catalog.rules_opcua import OPCUA_RULES
from auth_server.apps.auth.catalog.rules_platform import PLATFORM_RULES
from auth_server.apps.auth.catalog.rules_realtime import REALTIME_RULES
from auth_server.apps.auth.catalog.specs import (
    PermissionGroup,
    PermissionSpec,
    RoleSpec,
    RouteRuleSpec,
)

ROUTE_RULES: tuple[RouteRuleSpec, ...] = (
    *AUTH_RULES,
    *PLATFORM_RULES,
    *OPCUA_RULES,
    *REALTIME_RULES,
    *ASSISTANT_RULES,
)

__all__ = [
    "AC_MANAGE",
    "AC_VIEW",
    "ALL_CODES",
    "ASSET_MANAGE",
    "ASSET_VIEW",
    "ASSISTANT_USE",
    "AUTH_RULES",
    "COLLECT_MANAGE",
    "COLLECT_OPERATE",
    "COLLECT_VIEW",
    "DASHBOARD_EDIT",
    "DASHBOARD_MANAGE",
    "DASHBOARD_VIEW",
    "DATASET_BACKFILL",
    "DATASET_MANAGE",
    "DATASET_OVERRIDE",
    "DATASET_RECORD_WRITE",
    "DATASET_VIEW",
    "OPCUA_MANAGE",
    "OPCUA_OPERATE",
    "OPCUA_RULES",
    "OPCUA_VIEW",
    "PERMISSIONS",
    "PLATFORM_RULES",
    "REALTIME_RULES",
    "ROLES",
    "ROLE_ADMIN",
    "ROLE_MANAGE",
    "ROLE_VIEWER",
    "ROUTE_RULES",
    "ROUTE_RULE_MANAGE",
    "ROUTE_RULE_VIEW",
    "USER_DELETE",
    "USER_GRANT",
    "USER_MANAGE",
    "USER_VIEW",
    "VIEW_CODES",
    "PermissionGroup",
    "PermissionSpec",
    "RoleSpec",
    "RouteRuleSpec",
    "grouped_permissions",
]
