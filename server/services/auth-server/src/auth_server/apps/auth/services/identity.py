"""身份视图：把「用户 + 角色权限 + 直权 + 内置码基准」装成一个值对象。

三道闸、guards 与出参转换都读它，避免各处各查一遍权限表。
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import func, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.crud import permission_crud, user_crud
from auth_server.apps.auth.models import (
    Permission,
    Role,
    RolePermission,
    User,
    UserPermission,
)
from auth_server.apps.auth.services.guards import is_super_admin
from lib.errors import InfraError


@dataclass(frozen=True)
class Identity:
    """一个账号在某一时刻的完整授权画像。"""

    user: User
    role_codes: frozenset[str]
    direct_codes: frozenset[str]
    builtin_codes: frozenset[str]

    @property
    def codes(self) -> frozenset[str]:
        return self.role_codes | self.direct_codes

    @property
    def is_super(self) -> bool:
        return is_super_admin(self.codes, self.builtin_codes)

    def has_all(self, required: frozenset[str]) -> bool:
        """是否持有全部给定权限码。空集合视为满足。

        Args: required。
        """
        return required <= self.codes

    def has_any(self, required: frozenset[str]) -> bool:
        """是否持有其中任意一个。⚠ 空集合视为**不**满足。

        Args: required。
        """
        return bool(required & self.codes)


@dataclass(frozen=True)
class Operation:
    """一次写操作的调用者与来源。审计与不变式都读它。"""

    operator: Identity
    source_ip: str | None = None


async def load_identity(session: AsyncSession, user: User) -> Identity:
    """按已取到的用户行装配身份视图。

    Args: session, user。
    """
    await _ensure_role_loaded(session, user)
    effective = await user_crud.load_authorization(session, user)
    return Identity(
        user=user,
        role_codes=effective.role_codes,
        direct_codes=effective.direct_codes,
        builtin_codes=effective.builtin_codes,
    )


async def _ensure_role_loaded(session: AsyncSession, user: User) -> None:
    """补齐 `user.role`。

    ⚠ 关系是 `lazy="noload"`：没预加载时读到的是 **None 而不是报错**，
    转换成出参时才会在 `role.id` 上炸成 500。`session.refresh` 也救不了——
    它同样走 noload 策略。只能显式取一次再挂上去（同会话内命中身份映射，
    多数情况下不产生额外查询）。
    """
    # ⚠ 类型上 `role` 不可空，运行期在 noload 下却真的是 None，
    # 故这里必须按可空处理——收窄成 `is not None` 会被优化掉。
    if getattr(user, "role", None) is not None:
        return
    role = await session.get(Role, user.role_id)
    if role is None:
        raise InfraError("用户的角色缺失", context={"user_id": str(user.id)})
    user.role = role


async def load_identity_by_id(
    session: AsyncSession, user_id: uuid.UUID
) -> Identity | None:
    """按用户 id 装配身份视图；用户不存在返回 None。

    Args: session, user_id。
    """
    user = await user_crud.get_with_role(session, user_id)
    if user is None:
        return None
    return await load_identity(session, user)


async def count_super_admins(session: AsyncSession) -> int:
    """全权账号数量。删除/停用最后一个全权账号的保护要用它。

    ⚠ 必须是单条查询：逐个用户算权限会让保护逻辑的开销随用户数线性增长。

    Args: session。
    """
    builtin_total = await permission_crud.count_builtin(session)
    if builtin_total == 0:
        return 0
    from_role = select(User.id.label("user_id"), Permission.id.label("pid"))
    from_role = (
        from_role.join(RolePermission, RolePermission.role_id == User.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(Permission.is_builtin.is_(True))
    )
    from_direct = (
        select(
            UserPermission.user_id.label("user_id"),
            Permission.id.label("pid"),
        )
        .join(Permission, Permission.id == UserPermission.permission_id)
        .where(Permission.is_builtin.is_(True))
    )
    held = union(from_role, from_direct).subquery("held")
    full = (
        select(held.c.user_id)
        .group_by(held.c.user_id)
        .having(func.count() == builtin_total)
        .subquery("full")
    )
    result = await session.execute(select(func.count()).select_from(full))
    return int(result.scalar_one())
