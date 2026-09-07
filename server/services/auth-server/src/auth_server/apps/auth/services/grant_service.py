"""授权面：改派角色与覆盖式写直权。这是全系统的两个提权入口。

四条不变式在这里同时生效：授予不超过自身、目标不高于自身、自锁保护、
不能让系统失去最后一个全权账号。
"""

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.catalog import ROLE_MANAGE, USER_GRANT
from auth_server.apps.auth.crud import (
    permission_crud,
    role_crud,
    user_crud,
)
from auth_server.apps.auth.schemas import (
    AssignRoleIn,
    SetPermissionsIn,
    UserDetailOut,
)
from auth_server.apps.auth.services import audit, guards
from auth_server.apps.auth.services.identity import (
    Identity,
    Operation,
    count_super_admins,
    load_identity,
)
from auth_server.apps.auth.services.identity_cache import (
    IdentityCache,
    invalidate_after_commit,
)
from auth_server.apps.auth.services.presenters import to_user_detail
from lib.errors import NotFound, ValidationFailed
from lib.errors.base import FieldError

TARGET_TYPE = "user"

# 改自己的授权时必须保住的码，否则会把自己锁在门外且无法自救
SELF_LOCK_GUARD_CODES = frozenset({USER_GRANT, ROLE_MANAGE})


async def assign_role(
    session: AsyncSession,
    operation: Operation,
    *,
    user_id: uuid.UUID,
    payload: AssignRoleIn,
    cache: IdentityCache,
) -> UserDetailOut:
    """改派角色。

    Args: session, operation, user_id, payload, cache。
    """
    target = await _require_identity(session, user_id)
    role = await role_crud.get(session, payload.role_id)
    if role is None:
        raise NotFound("角色不存在")
    new_role_codes = await role_crud.codes_of(session, role.id)
    await _assert_grant_allowed(
        session,
        operation,
        _GrantCheck(
            target=target,
            next_codes=new_role_codes | target.direct_codes,
            granted=new_role_codes,
            action="改派角色",
        ),
    )
    before = {"role_id": str(target.user.role_id)}
    # ⚠ 必须同时改关系对象：只改 role_id 的话，已加载的 `user.role`
    # 仍指向旧角色，出参里会回显改派前的角色名
    target.user.role = role
    target.user.role_id = role.id
    await session.flush()
    audit.record(
        session,
        audit.Entry(
            actor=operation.operator.user,
            action=audit.ACTION_ROLE_ASSIGNED,
            target_type=TARGET_TYPE,
            target_id=str(user_id),
            change=audit.Change(
                before=before,
                after={"role_id": str(role.id), "role_name": role.name},
            ),
            source_ip=operation.source_ip,
        ),
    )
    invalidate_after_commit(session, cache, user_id)
    return to_user_detail(await load_identity(session, target.user))


async def set_direct_permissions(
    session: AsyncSession,
    operation: Operation,
    *,
    user_id: uuid.UUID,
    payload: SetPermissionsIn,
    cache: IdentityCache,
) -> UserDetailOut:
    """覆盖式写直权：给什么就是什么。

    Args: session, operation, user_id, payload, cache。
    """
    target = await _require_identity(session, user_id)
    requested = frozenset(payload.codes)
    ids = await _resolve_codes(session, requested)
    await _assert_grant_allowed(
        session,
        operation,
        _GrantCheck(
            target=target,
            next_codes=target.role_codes | requested,
            granted=requested,
            action="设置直权",
        ),
    )
    before = {"direct_permissions": sorted(target.direct_codes)}
    await user_crud.replace_direct_permissions(
        session, user_id=user_id, permission_ids=frozenset(ids.values())
    )
    await session.flush()
    audit.record(
        session,
        audit.Entry(
            actor=operation.operator.user,
            action=audit.ACTION_DIRECT_PERMISSIONS_SET,
            target_type=TARGET_TYPE,
            target_id=str(user_id),
            change=audit.Change(
                before=before,
                after={"direct_permissions": sorted(requested)},
            ),
            source_ip=operation.source_ip,
        ),
    )
    invalidate_after_commit(session, cache, user_id)
    return to_user_detail(await load_identity(session, target.user))


async def resolve_permission_ids(
    session: AsyncSession, codes: frozenset[str]
) -> dict[str, uuid.UUID]:
    """码 → id，任何一个码不在目录里就整体 400。

    Args: session, codes。
    """
    return await _resolve_codes(session, codes)


async def _resolve_codes(
    session: AsyncSession, codes: frozenset[str]
) -> dict[str, uuid.UUID]:
    found = await permission_crud.ids_by_codes(session, codes)
    missing = codes - found.keys()
    if missing:
        raise ValidationFailed(
            "存在未登记的权限码",
            details=tuple(
                FieldError(
                    field="codes",
                    code="unknown_permission_code",
                    message=f"未登记的权限码：{code}",
                )
                for code in sorted(missing)
            ),
        )
    return found


@dataclass(frozen=True)
class _GrantCheck:
    """一次授权变更的四个判定输入：改谁、改成什么、给了什么、叫什么。"""

    target: Identity
    next_codes: frozenset[str]
    granted: frozenset[str]
    action: str


async def _assert_grant_allowed(
    session: AsyncSession, operation: Operation, check: _GrantCheck
) -> None:
    operator = operation.operator
    target = check.target
    guards.assert_target_not_higher(
        operator_codes=operator.codes,
        target_codes=target.codes,
        is_super=operator.is_super,
        action=check.action,
    )
    guards.assert_grantable(
        operator_codes=operator.codes,
        granted_codes=check.granted,
        is_super=operator.is_super,
    )
    guards.assert_keeps_admin_capability(
        operator_id=operator.user.id,
        target_id=target.user.id,
        remaining_codes=check.next_codes,
        required_codes=SELF_LOCK_GUARD_CODES & operator.codes,
    )
    await _assert_keeps_a_super_admin(
        session,
        target=target,
        next_codes=check.next_codes,
        action=check.action,
    )


async def _assert_keeps_a_super_admin(
    session: AsyncSession,
    *,
    target: Identity,
    next_codes: frozenset[str],
    action: str,
) -> None:
    if not target.is_super:
        return
    if guards.is_super_admin(next_codes, target.builtin_codes):
        return
    guards.assert_not_last_super_admin(
        is_target_super=True,
        super_admin_count=await count_super_admins(session),
        action=action,
    )


async def _require_identity(
    session: AsyncSession, user_id: uuid.UUID
) -> Identity:
    user = await user_crud.get_with_role(session, user_id)
    if user is None:
        raise NotFound("用户不存在")
    return await load_identity(session, user)
