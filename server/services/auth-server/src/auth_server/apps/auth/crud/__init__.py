"""数据访问层。只被 services 层调用，不被 api 层直接调用。"""

from auth_server.apps.auth.crud.api_key import ApiKeyCrud, api_key_crud
from auth_server.apps.auth.crud.permission import (
    PermissionCrud,
    permission_crud,
)
from auth_server.apps.auth.crud.role import RoleCrud, role_crud
from auth_server.apps.auth.crud.route_rule import (
    RouteRuleCrud,
    route_rule_crud,
)
from auth_server.apps.auth.crud.user import (
    EffectivePermissions,
    UserCrud,
    user_crud,
)

__all__ = [
    "ApiKeyCrud",
    "EffectivePermissions",
    "PermissionCrud",
    "RoleCrud",
    "RouteRuleCrud",
    "UserCrud",
    "api_key_crud",
    "permission_crud",
    "role_crud",
    "route_rule_crud",
    "user_crud",
]
