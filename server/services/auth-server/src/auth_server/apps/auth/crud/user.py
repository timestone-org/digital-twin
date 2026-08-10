"""用户数据访问。只做查询与挂载，不提交——事务边界归 service 层。"""

import uuid
from dataclasses import dataclass

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import InstrumentedAttribute

from auth_server.apps.auth.models import (
    Permission,
    RolePermission,
    User,
    UserPermission,
)
from lib.db import CrudBase

SORTABLE = {
    "username": User.username,
    "created_at": User.created_at,
    "last_login_at": User.last_login_at,
}
DEFAULT_ORDER = (User.created_at.desc(), User.id.desc())


@dataclass(frozen=True)
class EffectivePermissions:
    """一个用户的权限来源拆分。`all_codes` 是两者的并集。"""

    role_codes: frozenset[str]
    direct_codes: frozenset[str]

    @property
    def all_codes(self) -> frozenset[str]:
        return self.role_codes | self.direct_codes


class UserCrud(CrudBase[User]):
    """`auth_users` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(User)

    async def get_with_role(
        self, session: AsyncSession, user_id: uuid.UUID
    ) -> User | None:
        """按主键取用户并预加载角色，避免序列化时触发惰性加载。

        Args: session, user_id。
        """
        result = await session.execute(
            select(User)
            .options(selectinload(User.role))
            .where(User.id == user_id)
        )
        return result.scalars().one_or_none()

    async def get_by_login(
        self, session: AsyncSession, login: str
    ) -> User | None:
        """按用户名或邮箱取用户（大小写不敏感）。

        Args: session, login。
        """
        normalized = login.strip().lower()
        result = await session.execute(
            select(User)
            .options(selectinload(User.role))
            .where(
                or_(
                    func.lower(User.username) == normalized,
                    func.lower(User.email) == normalized,
                )
            )
        )
        return result.scalars().one_or_none()

    async def exists_username(
        self, session: AsyncSession, username: str
    ) -> bool:
        """用户名是否已被占用（大小写不敏感）。

        Args: session, username。
        """
        return await self._exists(session, User.username, username)

    async def exists_email(self, session: AsyncSession, email: str) -> bool:
        """邮箱是否已被占用（大小写不敏感）。

        Args: session, email。
        """
        return await self._exists(session, User.email, email)

    async def count_by_role(
        self, session: AsyncSession, role_id: uuid.UUID
    ) -> int:
        """某个角色下的用户数。

        Args: session, role_id。
        """
        result = await session.execute(
            select(func.count())
            .select_from(User)
            .where(User.role_id == role_id)
        )
        return int(result.scalar_one())

    async def load_permissions(
        self, session: AsyncSession, user: User
    ) -> EffectivePermissions:
        """取该用户的角色权限码与直权码。

        Args: session, user。
        """
        role_rows = await session.execute(
            select(Permission.code)
            .join(
                RolePermission,
                RolePermission.permission_id == Permission.id,
            )
            .where(RolePermission.role_id == user.role_id)
        )
        direct_rows = await session.execute(
            select(Permission.code)
            .join(
                UserPermission,
                UserPermission.permission_id == Permission.id,
            )
            .where(UserPermission.user_id == user.id)
        )
        return EffectivePermissions(
            role_codes=frozenset(role_rows.scalars().all()),
            direct_codes=frozenset(direct_rows.scalars().all()),
        )

    async def replace_direct_permissions(
        self,
        session: AsyncSession,
        *,
        user_id: uuid.UUID,
        permission_ids: frozenset[uuid.UUID],
    ) -> None:
        """覆盖式重写直权表：先清后写，不做增量合并。

        Args: session, user_id, permission_ids。
        """
        existing = await session.execute(
            select(UserPermission).where(UserPermission.user_id == user_id)
        )
        for row in existing.scalars().all():
            await session.delete(row)
        await session.flush()
        for permission_id in sorted(permission_ids):
            session.add(
                UserPermission(user_id=user_id, permission_id=permission_id)
            )

    @staticmethod
    async def count_direct_permissions(
        session: AsyncSession, user_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, int]:
        """一次查出这批用户各自的直权条数。没有直权的用户不在返回里。

        ⚠ 一次 GROUP BY 而不是逐行 count：逐行就是 N+1，
        页大小 200 时是 200 次往返。

        Args: session, user_ids。
        """
        if not user_ids:
            return {}
        result = await session.execute(
            select(UserPermission.user_id, func.count())
            .where(UserPermission.user_id.in_(user_ids))
            .group_by(UserPermission.user_id)
        )
        return {user_id: int(total) for user_id, total in result.all()}

    @staticmethod
    def build_query(
        *,
        keyword: str | None,
        is_active: bool | None,
        role_id: uuid.UUID | None,
    ) -> Select[tuple[User]]:
        """按白名单条件构造列表查询。

        Args: keyword, is_active, role_id。
        """
        statement = select(User).options(selectinload(User.role))
        if keyword:
            pattern = f"%{keyword.lower()}%"
            statement = statement.where(
                or_(
                    func.lower(User.username).like(pattern),
                    func.lower(User.email).like(pattern),
                    func.lower(func.coalesce(User.full_name, "")).like(pattern),
                )
            )
        if is_active is not None:
            statement = statement.where(User.is_active.is_(is_active))
        if role_id is not None:
            statement = statement.where(User.role_id == role_id)
        return statement

    @staticmethod
    async def _exists(
        session: AsyncSession,
        column: InstrumentedAttribute[str],
        value: str,
    ) -> bool:
        result = await session.execute(
            select(func.count())
            .select_from(User)
            .where(func.lower(column) == value.strip().lower())
        )
        return int(result.scalar_one()) > 0


user_crud = UserCrud()
