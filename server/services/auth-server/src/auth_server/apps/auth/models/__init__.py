"""`auth` schema 的全部 ORM 模型。

alembic 的 `env.py` 通过本文件收集元数据，故须维护 `__all__`：漏一个即迁移漏表。
"""

from auth_server.apps.auth.models.audit import AuditLog
from auth_server.apps.auth.models.base import Base
from auth_server.apps.auth.models.permission import (
    PERMISSION_KINDS,
    Permission,
    RolePermission,
    UserPermission,
)
from auth_server.apps.auth.models.role import Role
from auth_server.apps.auth.models.route_rule import (
    HTTP_METHODS,
    MATCH_MODES,
    RouteRule,
)
from auth_server.apps.auth.models.user import User

__all__ = [
    "HTTP_METHODS",
    "MATCH_MODES",
    "PERMISSION_KINDS",
    "AuditLog",
    "Base",
    "Permission",
    "Role",
    "RolePermission",
    "RouteRule",
    "User",
    "UserPermission",
]
