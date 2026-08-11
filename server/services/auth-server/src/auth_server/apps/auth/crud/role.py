"""角色数据访问。"""

import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.models import (
    Permission,
    Role,
    RolePermission,
    User,
)
from lib.db import CrudBase

SORTABLE = {"name": Role.name, "created_at": Role.created_at}
DEFAULT_ORDER = (Role.name.asc(),)


class RoleCrud(CrudBase[Role]):
    """`auth_roles` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(Role)

    async def get_by_name(
        self, session: AsyncSession, name: str
    ) -> Role | None:
        """按角色名取角色。

        Args: session, name。
        """
        result = await session.execute(select(Role).where(Role.name == name))
        return result.scalars().one_or_none()

    async def codes_of(
        self, session: AsyncSession, role_id: uuid.UUID
    ) -> frozenset[str]:
        """取某个角色持有的权限码。

        Args: session, role_id。
        """
        result = await session.execute(
            select(Permission.code)
            .join(
                RolePermission,
                RolePermission.permission_id == Permission.id,
            )
            .where(RolePermission.role_id == role_id)
        )
        return frozenset(result.scalars().all())

    async def codes_by_role(
        self, session: AsyncSession, role_ids: frozenset[uuid.UUID]
    ) -> dict[uuid.UUID, frozenset[str]]:
        """批量取多个角色的权限码，避免列表页 N+1。

        Args: session, role_ids。
        """
        if not role_ids:
            return {}
        rows = await session.execute(
            select(RolePermission.role_id, Permission.code)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(RolePermission.role_id.in_(role_ids))
        )
        buckets: dict[uuid.UUID, set[str]] = {
            role_id: set() for role_id in role_ids
        }
        for role_id, code in rows.all():
            buckets[role_id].add(code)
        return {role_id: frozenset(codes) for role_id, codes in buckets.items()}

    async def user_counts(
        self, session: AsyncSession, role_ids: frozenset[uuid.UUID]
    ) -> dict[uuid.UUID, int]:
        """批量取多个角色下的用户数。

        Args: session, role_ids。
        """
        if not role_ids:
            return {}
        rows = await session.execute(
            select(User.role_id, func.count())
            .where(User.role_id.in_(role_ids))
            .group_by(User.role_id)
        )
        counts = dict.fromkeys(role_ids, 0)
        for role_id, total in rows.all():
            counts[role_id] = int(total)
        return counts

    async def replace_permissions(
        self,
        session: AsyncSession,
        *,
        role_id: uuid.UUID,
        permission_ids: frozenset[uuid.UUID],
    ) -> None:
        """覆盖式重写角色权限表。

        Args: session, role_id, permission_ids。
        """
        existing = await session.execute(
            select(RolePermission).where(RolePermission.role_id == role_id)
        )
        for row in existing.scalars().all():
            await session.delete(row)
        await session.flush()
        for permission_id in sorted(permission_ids):
            session.add(
                RolePermission(role_id=role_id, permission_id=permission_id)
            )

    @staticmethod
    def build_query(*, keyword: str | None) -> Select[tuple[Role]]:
        """按关键字构造列表查询。

        Args: keyword。
        """
        statement = select(Role)
        if keyword:
            pattern = f"%{keyword.lower()}%"
            statement = statement.where(func.lower(Role.name).like(pattern))
        return statement


role_crud = RoleCrud()
