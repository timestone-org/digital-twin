"""用户数据访问。只做查询与挂载，不提交——事务边界归 service 层。"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload
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
    """一个用户的权限来源拆分，外加全权判定的基准码集。"""

    role_codes: frozenset[str]
    direct_codes: frozenset[str]
    # 内置码全集。全权判定以它为基准，与前两列同一条语句取回
    builtin_codes: frozenset[str]

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

        ⚠ 单行的多对一用 `joinedload` 而不是 `selectinload`：后者是**另发一条
        语句**去捞角色，而本方法在 `/verify` 里被每一个请求各走一次——省下的
        那一次往返乘的是全站请求量。列表面仍用 selectinload（见
        `build_query`）：那里一条 IN 查询就带回整页的角色。

        Args: session, user_id。
        """
        result = await session.execute(
            select(User)
            .options(joinedload(User.role))
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

    async def load_authorization(
        self, session: AsyncSession, user: User
    ) -> EffectivePermissions:
        """一条语句取回角色码、直权码与内置码基准。

        ⚠ 三者合成一条而不是各查一遍：这三次查询原本挂在 `/verify` 上，而
        `/verify` 是边缘对**每一个**请求都要打的子请求——省下的两次往返乘的
        是全站请求量。合并不改语义：三列各自独立判定，互不影响。

        Args: session, user。
        """
        result = await session.execute(
            _authorization_query(role_id=user.role_id, user_id=user.id)
        )
        return _split_codes(result.tuples().all())

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


def _authorization_query(
    *, role_id: uuid.UUID, user_id: uuid.UUID
) -> Select[tuple[str, bool, bool, bool]]:
    """选出「该角色的 ∪ 该用户直授的 ∪ 内置的」权限码，并标出各自的来源。

    ⚠ 两条关联表走 `LEFT JOIN` 且把身份条件写进 ON 而不是 WHERE：写进 WHERE
    会把没被这个人持有的内置码一起筛掉，于是全权判定的基准凭空缩水。

    Args: role_id, user_id。
    """
    return (
        select(
            Permission.code,
            Permission.is_builtin,
            RolePermission.role_id.is_not(None).label("by_role"),
            UserPermission.user_id.is_not(None).label("by_user"),
        )
        .outerjoin(
            RolePermission,
            (RolePermission.permission_id == Permission.id)
            & (RolePermission.role_id == role_id),
        )
        .outerjoin(
            UserPermission,
            (UserPermission.permission_id == Permission.id)
            & (UserPermission.user_id == user_id),
        )
        .where(
            Permission.is_builtin.is_(True)
            | RolePermission.role_id.is_not(None)
            | UserPermission.user_id.is_not(None)
        )
    )


def _split_codes(
    rows: Sequence[tuple[str, bool, bool, bool]],
) -> EffectivePermissions:
    """把带来源标记的行摊成三个码集。

    Args: rows。
    """
    role_codes: set[str] = set()
    direct_codes: set[str] = set()
    builtin_codes: set[str] = set()
    for code, is_builtin, by_role, by_user in rows:
        if by_role:
            role_codes.add(code)
        if by_user:
            direct_codes.add(code)
        if is_builtin:
            builtin_codes.add(code)
    return EffectivePermissions(
        role_codes=frozenset(role_codes),
        direct_codes=frozenset(direct_codes),
        builtin_codes=frozenset(builtin_codes),
    )


user_crud = UserCrud()
