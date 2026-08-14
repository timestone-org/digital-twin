"""认证模块的对外模型。任何层都可读。"""

from auth_server.apps.auth.schemas.api_key import (
    ApiKeyCreateIn,
    ApiKeyFilters,
    ApiKeyOut,
    ApiKeySecretOut,
)
from auth_server.apps.auth.schemas.common import (
    InputModel,
    OutputModel,
    Trimmed,
    Utc,
)
from auth_server.apps.auth.schemas.password import RawPassword
from auth_server.apps.auth.schemas.permission import (
    PermissionCatalogOut,
    PermissionCodesOut,
    PermissionGroupOut,
    PermissionKind,
    PermissionOut,
)
from auth_server.apps.auth.schemas.role import (
    RoleCreateIn,
    RoleOut,
    RolePermissionsIn,
    RoleUpdateIn,
)
from auth_server.apps.auth.schemas.route_rule import (
    HttpMethod,
    MatchMode,
    RouteRuleCreateIn,
    RouteRuleOut,
    RouteRuleUpdateIn,
)
from auth_server.apps.auth.schemas.session import (
    LoginIn,
    RefreshIn,
    SessionOut,
    TokenPairOut,
)
from auth_server.apps.auth.schemas.user import (
    AssignRoleIn,
    ChangePasswordIn,
    MeUpdateIn,
    RegistrationIn,
    ResetPasswordIn,
    RoleRef,
    SetPermissionsIn,
    UserCreateIn,
    UserDetailOut,
    UserFilters,
    UserListItemOut,
    UserOut,
    UserUpdateIn,
)

__all__ = [
    "ApiKeyCreateIn",
    "ApiKeyFilters",
    "ApiKeyOut",
    "ApiKeySecretOut",
    "AssignRoleIn",
    "ChangePasswordIn",
    "HttpMethod",
    "InputModel",
    "LoginIn",
    "MatchMode",
    "MeUpdateIn",
    "OutputModel",
    "PermissionCatalogOut",
    "PermissionCodesOut",
    "PermissionGroupOut",
    "PermissionKind",
    "PermissionOut",
    "RawPassword",
    "RefreshIn",
    "RegistrationIn",
    "ResetPasswordIn",
    "RoleCreateIn",
    "RoleOut",
    "RolePermissionsIn",
    "RoleRef",
    "RoleUpdateIn",
    "RouteRuleCreateIn",
    "RouteRuleOut",
    "RouteRuleUpdateIn",
    "SessionOut",
    "SetPermissionsIn",
    "TokenPairOut",
    "Trimmed",
    "UserCreateIn",
    "UserDetailOut",
    "UserFilters",
    "UserListItemOut",
    "UserOut",
    "UserUpdateIn",
    "Utc",
]
