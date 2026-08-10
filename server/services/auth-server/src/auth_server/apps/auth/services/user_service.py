"""用户管理面。每个写路径**最先**跑授权不变式（guards），再动数据。"""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.crud import role_crud, user_crud
from auth_server.apps.auth.crud.user import DEFAULT_ORDER as USER_ORDER
from auth_server.apps.auth.crud.user import SORTABLE as USER_SORTABLE
from auth_server.apps.auth.models import User
from auth_server.apps.auth.schemas import (
    ResetPasswordIn,
    UserCreateIn,
    UserDetailOut,
    UserFilters,
    UserListItemOut,
    UserUpdateIn,
)
from auth_server.apps.auth.services import audit, guards
from auth_server.apps.auth.services.identity import (
    Identity,
    Operation,
    count_super_admins,
    load_identity,
)
from auth_server.apps.auth.services.presenters import (
    to_user_detail,
    to_user_list_item,
)
from lib.auth import PasswordHasher
from lib.errors import Conflict, NotFound
from lib.web import Page, PageParams

TARGET_TYPE = "user"


async def list_users(
    session: AsyncSession,
    *,
    filters: UserFilters,
    page: PageParams,
    sort: str | None,
) -> Page[UserListItemOut]:
    """用户列表。角色随查询预加载，直权条数一次 GROUP BY 补齐，都不走逐行查询。

    Args: session, filters, page, sort。
    """
    statement = user_crud.build_query(
        keyword=filters.q,
        is_active=filters.is_active,
        role_id=filters.role_id,
    )
    statement = user_crud.order_by_whitelist(
        statement, sort=sort, allowed=USER_SORTABLE, default=USER_ORDER
    )
    rows, total = await user_crud.list_page(
        session,
        statement=statement,
        offset=page.offset,
        limit=page.size,
    )
    counts = await user_crud.count_direct_permissions(
        session, [row.id for row in rows]
    )
    return Page[UserListItemOut](
        items=[
            to_user_list_item(row, direct_count=counts.get(row.id, 0))
            for row in rows
        ],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_user(session: AsyncSession, user_id: uuid.UUID) -> UserDetailOut:
    """用户详情。不存在与无权看见都返回 404。

    Args: session, user_id。
    """
    return to_user_detail(await _require_identity(session, user_id))


async def create_user(
    session: AsyncSession,
    operation: Operation,
    *,
    payload: UserCreateIn,
    hasher: PasswordHasher,
) -> UserDetailOut:
    """建号。目标角色的权限集不得超过操作者。

    Args: session, operation, payload, hasher。
    """
    role = await role_crud.get(session, payload.role_id)
    if role is None:
        raise NotFound("角色不存在")
    role_codes = await role_crud.codes_of(session, role.id)
    guards.assert_grantable(
        operator_codes=operation.operator.codes,
        granted_codes=role_codes,
        is_super=operation.operator.is_super,
    )
    user = User(
        username=payload.username,
        email=payload.email,
        hashed_password=hasher.hash(payload.password),
        full_name=payload.full_name,
        phone=payload.phone,
        is_active=payload.is_active,
        role_id=role.id,
    )
    await _insert(session, user)
    _audit(session, operation, audit.ACTION_USER_CREATED, user)
    return to_user_detail(await load_identity(session, user))


async def update_user(
    session: AsyncSession,
    operation: Operation,
    *,
    user_id: uuid.UUID,
    payload: UserUpdateIn,
) -> UserDetailOut:
    """改他人资料。

    Args: session, operation, user_id, payload。
    """
    target = await _require_identity(session, user_id)
    _assert_can_touch(operation, target, action="修改")
    changes = payload.model_dump(exclude_unset=True)
    before = _snapshot(target.user)
    user_crud.apply_changes(target.user, changes)
    await _flush(session)
    _audit(
        session,
        operation,
        audit.ACTION_USER_UPDATED,
        target.user,
        before=before,
    )
    return to_user_detail(await load_identity(session, target.user))


async def delete_user(
    session: AsyncSession,
    operation: Operation,
    *,
    user_id: uuid.UUID,
) -> None:
    """删号。不可对自己、不可对权限更高者、不可删掉最后一个全权账号。

    Args: session, operation, user_id。
    """
    target = await _require_identity(session, user_id)
    guards.assert_not_self(
        operator_id=operation.operator.user.id,
        target_id=user_id,
        action="执行删除",
    )
    _assert_can_touch(operation, target, action="删除")
    guards.assert_not_last_super_admin(
        target_is_super=target.is_super,
        super_admin_count=await count_super_admins(session),
        action="删除",
    )
    audit.record(
        session,
        actor=operation.operator.user,
        action=audit.ACTION_USER_DELETED,
        target_type=TARGET_TYPE,
        target_id=str(target.user.id),
        before=_snapshot(target.user),
        source_ip=operation.source_ip,
    )
    await user_crud.delete(session, target.user)


async def set_active(
    session: AsyncSession,
    operation: Operation,
    *,
    user_id: uuid.UUID,
    is_active: bool,
) -> UserDetailOut:
    """启用或停用账号。停用同样受「最后一个全权账号」保护。

    Args: session, operation, user_id, is_active。
    """
    target = await _require_identity(session, user_id)
    action = "启用" if is_active else "停用"
    _assert_can_touch(operation, target, action=action)
    if not is_active:
        guards.assert_not_self(
            operator_id=operation.operator.user.id,
            target_id=user_id,
            action="执行停用",
        )
        guards.assert_not_last_super_admin(
            target_is_super=target.is_super,
            super_admin_count=await count_super_admins(session),
            action="停用",
        )
    before = _snapshot(target.user)
    target.user.is_active = is_active
    await _flush(session)
    _audit(
        session,
        operation,
        (
            audit.ACTION_USER_ACTIVATED
            if is_active
            else audit.ACTION_USER_DEACTIVATED
        ),
        target.user,
        before=before,
    )
    return to_user_detail(await load_identity(session, target.user))


async def reset_password(
    session: AsyncSession,
    operation: Operation,
    *,
    user_id: uuid.UUID,
    payload: ResetPasswordIn,
    hasher: PasswordHasher,
) -> None:
    """管理员重置他人密码。⚠ 不加「目标不高于自身」就等于可以接管全权账号。

    Args: session, operation, user_id, payload, hasher。
    """
    target = await _require_identity(session, user_id)
    _assert_can_touch(operation, target, action="重置密码")
    target.user.hashed_password = hasher.hash(payload.new_password)
    await _flush(session)
    _audit(session, operation, audit.ACTION_PASSWORD_RESET, target.user)


async def _require_identity(
    session: AsyncSession, user_id: uuid.UUID
) -> Identity:
    user = await user_crud.get_with_role(session, user_id)
    if user is None:
        raise NotFound("用户不存在")
    return await load_identity(session, user)


def _assert_can_touch(
    operation: Operation, target: Identity, *, action: str
) -> None:
    guards.assert_target_not_higher(
        operator_codes=operation.operator.codes,
        target_codes=target.codes,
        is_super=operation.operator.is_super,
        action=action,
    )


def _snapshot(user: User) -> dict[str, object]:
    return {
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "phone": user.phone,
        "is_active": user.is_active,
        "role_id": str(user.role_id),
    }


def _audit(
    session: AsyncSession,
    operation: Operation,
    action: str,
    user: User,
    *,
    before: dict[str, object] | None = None,
) -> None:
    audit.record(
        session,
        actor=operation.operator.user,
        action=action,
        target_type=TARGET_TYPE,
        target_id=str(user.id),
        before=before,
        after=_snapshot(user),
        source_ip=operation.source_ip,
    )


async def _insert(session: AsyncSession, user: User) -> None:
    session.add(user)
    await _flush(session)


async def _flush(session: AsyncSession) -> None:
    try:
        await session.flush()
    except IntegrityError as error:
        raise Conflict("用户名或邮箱已被占用") from error
