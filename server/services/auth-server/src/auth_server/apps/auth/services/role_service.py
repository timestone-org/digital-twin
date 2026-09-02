"""角色管理面。内置角色的名称与权限集由种子维护，只允许改描述。"""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.crud import role_crud, user_crud
from auth_server.apps.auth.crud.role import DEFAULT_ORDER, SORTABLE
from auth_server.apps.auth.models import Role
from auth_server.apps.auth.schemas import (
    RoleCreateIn,
    RoleOut,
    RolePermissionsIn,
    RoleUpdateIn,
)
from auth_server.apps.auth.services import audit, guards
from auth_server.apps.auth.services.grant_service import (
    resolve_permission_ids,
)
from auth_server.apps.auth.services.identity import Operation
from auth_server.apps.auth.services.identity_cache import (
    IdentityCache,
    invalidate_all_after_commit,
)
from auth_server.apps.auth.services.presenters import to_role_out
from lib.errors import Conflict, NotFound
from lib.web import Page, PageParams

TARGET_TYPE = "role"


async def list_roles(
    session: AsyncSession,
    *,
    keyword: str | None,
    page: PageParams,
    sort: str | None,
) -> Page[RoleOut]:
    """角色列表。权限码与用户数批量查，不逐行发查询。

    Args: session, keyword, page, sort。
    """
    statement = role_crud.order_by_whitelist(
        role_crud.build_query(keyword=keyword),
        sort=sort,
        allowed=dict(SORTABLE),
        default=DEFAULT_ORDER,
    )
    rows, total = await role_crud.list_page(
        session, statement=statement, offset=page.offset, limit=page.size
    )
    ids = frozenset(row.id for row in rows)
    codes = await role_crud.codes_by_role(session, ids)
    counts = await role_crud.user_counts(session, ids)
    return Page[RoleOut](
        items=[
            to_role_out(
                row,
                codes=codes.get(row.id, frozenset()),
                user_count=counts.get(row.id, 0),
            )
            for row in rows
        ],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_role(session: AsyncSession, role_id: uuid.UUID) -> RoleOut:
    """角色详情。

    Args: session, role_id。
    """
    role = await _require_role(session, role_id)
    return await _present(session, role)


async def create_role(
    session: AsyncSession,
    operation: Operation,
    *,
    payload: RoleCreateIn,
) -> RoleOut:
    """建角色，可同时授予一组权限码。

    Args: session, operation, payload。
    """
    requested = frozenset(payload.codes)
    ids = await resolve_permission_ids(session, requested)
    guards.assert_grantable(
        operator_codes=operation.operator.codes,
        granted_codes=requested,
        is_super=operation.operator.is_super,
    )
    role = Role(name=payload.name, description=payload.description)
    session.add(role)
    await _flush(session)
    await role_crud.replace_permissions(
        session, role_id=role.id, permission_ids=frozenset(ids.values())
    )
    await session.flush()
    _audit(
        session,
        operation,
        audit.ACTION_ROLE_CREATED,
        role,
        audit.Change(
            after={"name": role.name, "permissions": sorted(requested)}
        ),
    )
    return await _present(session, role)


async def update_role(
    session: AsyncSession,
    operation: Operation,
    *,
    role_id: uuid.UUID,
    payload: RoleUpdateIn,
    cache: IdentityCache,
) -> RoleOut:
    """改角色。

    ⚠ 改名要整体丢缓存：角色名会进签名身份头，而缓存按用户分键，认不出
    「这批人的角色刚改了名」。

    Args: session, operation, role_id, payload, cache。
    """
    role = await _require_role(session, role_id)
    changes = payload.model_dump(exclude_unset=True)
    guards.assert_builtin_role_mutable(
        is_builtin=role.is_builtin,
        is_changing_name="name" in changes,
        is_changing_codes=False,
    )
    await _assert_role_reachable(session, operation, role)
    before = {"name": role.name, "description": role.description}
    role_crud.apply_changes(role, changes)
    await _flush(session)
    _audit(
        session,
        operation,
        audit.ACTION_ROLE_UPDATED,
        role,
        audit.Change(
            before=before,
            after={"name": role.name, "description": role.description},
        ),
    )
    invalidate_all_after_commit(session, cache)
    return await _present(session, role)


async def set_role_permissions(
    session: AsyncSession,
    operation: Operation,
    *,
    role_id: uuid.UUID,
    payload: RolePermissionsIn,
    cache: IdentityCache,
) -> RoleOut:
    """覆盖式设置角色权限。

    ⚠ 同样整体丢缓存：这一改动牵动持有该角色的**每一个**账号。

    Args: session, operation, role_id, payload, cache。
    """
    role = await _require_role(session, role_id)
    guards.assert_builtin_role_mutable(
        is_builtin=role.is_builtin,
        is_changing_name=False,
        is_changing_codes=True,
    )
    requested = frozenset(payload.codes)
    ids = await resolve_permission_ids(session, requested)
    await _assert_role_reachable(session, operation, role)
    guards.assert_grantable(
        operator_codes=operation.operator.codes,
        granted_codes=requested,
        is_super=operation.operator.is_super,
    )
    before = {"permissions": sorted(await role_crud.codes_of(session, role.id))}
    await role_crud.replace_permissions(
        session, role_id=role.id, permission_ids=frozenset(ids.values())
    )
    await session.flush()
    _audit(
        session,
        operation,
        audit.ACTION_ROLE_PERMISSIONS_SET,
        role,
        audit.Change(before=before, after={"permissions": sorted(requested)}),
    )
    invalidate_all_after_commit(session, cache)
    return await _present(session, role)


async def delete_role(
    session: AsyncSession,
    operation: Operation,
    *,
    role_id: uuid.UUID,
) -> None:
    """删角色。内置角色不可删；角色上还挂着人时先改派。

    ⚠ 这里不用动身份缓存：角色下还有人就删不掉，而改派本身已经逐个失效过。

    Args: session, operation, role_id。
    """
    role = await _require_role(session, role_id)
    guards.assert_builtin_role_mutable(
        is_builtin=role.is_builtin,
        is_changing_name=True,
        is_changing_codes=True,
    )
    await _assert_role_reachable(session, operation, role)
    if await user_crud.count_by_role(session, role.id) > 0:
        raise Conflict("该角色下还有用户，请先改派后再删除")
    _audit(
        session,
        operation,
        audit.ACTION_ROLE_DELETED,
        role,
        audit.Change(before={"name": role.name}),
    )
    await role_crud.delete(session, role)


async def _assert_role_reachable(
    session: AsyncSession, operation: Operation, role: Role
) -> None:
    guards.assert_role_not_higher(
        operator_codes=operation.operator.codes,
        role_codes=await role_crud.codes_of(session, role.id),
        is_super=operation.operator.is_super,
    )


async def _require_role(session: AsyncSession, role_id: uuid.UUID) -> Role:
    role = await role_crud.get(session, role_id)
    if role is None:
        raise NotFound("角色不存在")
    return role


async def _present(session: AsyncSession, role: Role) -> RoleOut:
    return to_role_out(
        role,
        codes=await role_crud.codes_of(session, role.id),
        user_count=await user_crud.count_by_role(session, role.id),
    )


def _audit(
    session: AsyncSession,
    operation: Operation,
    action: str,
    role: Role,
    change: audit.Change = audit.NO_CHANGE,
) -> None:
    audit.record(
        session,
        audit.Entry(
            actor=operation.operator.user,
            action=action,
            target_type=TARGET_TYPE,
            target_id=str(role.id),
            change=change,
            source_ip=operation.source_ip,
        ),
    )


async def _flush(session: AsyncSession) -> None:
    try:
        await session.flush()
    except IntegrityError as error:
        raise Conflict("角色名已被占用") from error
