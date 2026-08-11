"""授权不变式：纯函数，全部写路径在 service 层最先调用。

没有这几条，「某个角色不含 X」只是种子配置的默认值，不是安全属性——
持 `role:manage` + `user:grant` 的账号三步即可自升全权：
建角色 → 授全部码 → 改派自己。

**全权账号**（有效码集 ⊇ 内置码集）对前两条豁免。判定不看角色名，
因此内置角色改名或增删都不影响它。
"""

import uuid

from auth_server.apps.auth.errors import (
    BuiltinImmutable,
    GrantExceedsOperator,
    SelfLockout,
    TargetHigherPrivileged,
)


def is_super_admin(
    held_codes: frozenset[str], builtin_codes: frozenset[str]
) -> bool:
    """是否全权账号。基准集只收内置码，手工建码不影响判定。

    Args: held_codes, builtin_codes。
    """
    return bool(builtin_codes) and builtin_codes <= held_codes


def assert_grantable(
    *,
    operator_codes: frozenset[str],
    granted_codes: frozenset[str],
    is_super: bool,
) -> None:
    """授予不超过自身。

    Args: operator_codes, granted_codes, is_super。
    """
    if is_super:
        return
    exceeding = granted_codes - operator_codes
    if exceeding:
        listed = "、".join(sorted(exceeding))
        raise GrantExceedsOperator(f"不能授予自己不具备的权限：{listed}")


def assert_target_not_higher(
    *,
    operator_codes: frozenset[str],
    target_codes: frozenset[str],
    is_super: bool,
    action: str,
) -> None:
    """目标不高于自身。挡的是「重置全权管理员的密码后接管账号」。

    Args: operator_codes, target_codes, is_super,
        action（写进 message 的动作名）。
    """
    if is_super:
        return
    if target_codes - operator_codes:
        raise TargetHigherPrivileged(f"目标账号的权限高于你，无法{action}")


def assert_role_not_higher(
    *,
    operator_codes: frozenset[str],
    role_codes: frozenset[str],
    is_super: bool,
) -> None:
    """被改角色的**当前**码集不得超过操作者。

    ⚠ 只校验「新码集 ⊆ 操作者」是不够的：那对「把高权角色**降**到自己这一层」
    完全不设防，低权账号一条改角色请求即可摧毁并劫持内置管理员角色。

    Args: operator_codes, role_codes, is_super。
    """
    if is_super:
        return
    if role_codes - operator_codes:
        raise TargetHigherPrivileged("该角色的权限高于你，无法修改")


def assert_builtin_role_mutable(
    *,
    is_builtin: bool,
    is_changing_name: bool,
    is_changing_codes: bool,
) -> None:
    """内置角色的名称与权限集不可改（描述仍可改）。

    ⚠ `name` 是种子的幂等键：改名后种子只会新建一个空壳而不是修复它。

    Args: is_builtin, is_changing_name, is_changing_codes。
    """
    if not is_builtin:
        return
    if is_changing_name:
        raise BuiltinImmutable("内置角色的名称不可修改")
    if is_changing_codes:
        raise BuiltinImmutable("内置角色的权限集由种子维护，不可修改")


def assert_not_self(
    *, operator_id: uuid.UUID, target_id: uuid.UUID, action: str
) -> None:
    """禁止对自己执行该操作。

    Args: operator_id, target_id, action。
    """
    if operator_id == target_id:
        raise SelfLockout(f"不能对自己{action}")


def assert_not_last_super_admin(
    *, is_target_super: bool, super_admin_count: int, action: str
) -> None:
    """不能让系统失去最后一个全权账号。

    Args: is_target_super, super_admin_count, action。
    """
    if is_target_super and super_admin_count <= 1:
        raise SelfLockout(f"这是最后一个全权账号，不能{action}")


def assert_keeps_admin_capability(
    *,
    operator_id: uuid.UUID,
    target_id: uuid.UUID,
    remaining_codes: frozenset[str],
    required_codes: frozenset[str],
) -> None:
    """改自己的权限时不得移除赖以继续管理的码，否则会把自己锁在门外。

    Args: operator_id, target_id, remaining_codes, required_codes。
    """
    if operator_id != target_id:
        return
    missing = required_codes - remaining_codes
    if missing:
        listed = "、".join(sorted(missing))
        raise SelfLockout(f"该操作会移除你自己的管理权限：{listed}")
