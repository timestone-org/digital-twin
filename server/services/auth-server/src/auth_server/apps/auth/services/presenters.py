"""ORM → 对外模型的转换。**ORM 模型绝不直接返给 HTTP 层。**

放在 service 边界而不是 api 层：转换要读权限集合，那是业务知识。
"""

from typing import cast

from auth_server.apps.auth.models import Permission, Role, RouteRule, User
from auth_server.apps.auth.schemas import (
    HttpMethod,
    MatchMode,
    PermissionOut,
    RoleOut,
    RoleRef,
    RouteRuleOut,
    UserDetailOut,
    UserListItemOut,
    UserOut,
)
from auth_server.apps.auth.services.identity import Identity


def to_role_ref(role: Role) -> RoleRef:
    """角色的引用形态。

    Args: role。
    """
    return RoleRef(
        id=role.id,
        name=role.name,
        description=role.description,
        is_builtin=role.is_builtin,
    )


def to_user_out(user: User) -> UserOut:
    """用户列表项。调用方需保证 `user.role` 已预加载。

    Args: user。
    """
    return UserOut(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        avatar_url=user.avatar_url,
        phone=user.phone,
        is_active=user.is_active,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        updated_at=user.updated_at,
        role=to_role_ref(user.role),
    )


def to_user_list_item(user: User, *, direct_count: int) -> UserListItemOut:
    """用户列表项。调用方需保证 `user.role` 已预加载。

    Args: user, direct_count。
    """
    base = to_user_out(user)
    return UserListItemOut(
        **base.model_dump(exclude={"role"}),
        role=base.role,
        direct_permission_count=direct_count,
    )


def to_user_detail(identity: Identity) -> UserDetailOut:
    """用户详情：角色权限与直权分开返回。

    Args: identity。
    """
    base = to_user_out(identity.user)
    return UserDetailOut(
        **base.model_dump(exclude={"role"}),
        role=base.role,
        role_permissions=sorted(identity.role_codes),
        direct_permissions=sorted(identity.direct_codes),
        permissions=sorted(identity.codes),
    )


def to_role_out(
    role: Role, *, codes: frozenset[str], user_count: int
) -> RoleOut:
    """角色详情。

    Args: role, codes, user_count。
    """
    return RoleOut(
        id=role.id,
        name=role.name,
        description=role.description,
        is_builtin=role.is_builtin,
        created_at=role.created_at,
        updated_at=role.updated_at,
        permissions=sorted(codes),
        user_count=user_count,
    )


def to_permission_out(permission: Permission) -> PermissionOut:
    """权限码。

    Args: permission。
    """
    return PermissionOut.model_validate(permission)


def to_route_rule_out(rule: RouteRule) -> RouteRuleOut:
    """路由规则。

    Args: rule。
    """
    return RouteRuleOut(
        id=rule.id,
        # 取值由表上的 CHECK 约束保证，比类型检查器知道得多
        http_method=cast(HttpMethod, rule.http_method),
        match_mode=cast(MatchMode, rule.match_mode),
        path_pattern=rule.path_pattern,
        permission_codes=sorted(rule.permission_codes),
        priority=rule.priority,
        is_enabled=rule.is_enabled,
        is_builtin=rule.is_builtin,
        description=rule.description,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )
