"""权限目录数据访问。目录是只读面，写入只发生在种子里。"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.models import Permission
from lib.db import CrudBase


class PermissionCrud(CrudBase[Permission]):
    """`auth_permissions` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(Permission)

    async def list_all(self, session: AsyncSession) -> list[Permission]:
        """取全部权限码，按分组与组内序号排列。"""
        result = await session.execute(
            select(Permission).order_by(
                Permission.group_code.asc(),
                Permission.sort_order.asc(),
                Permission.code.asc(),
            )
        )
        return list(result.scalars().all())

    async def ids_by_codes(
        self, session: AsyncSession, codes: frozenset[str]
    ) -> dict[str, uuid.UUID]:
        """码 → id 映射。缺失的码不会出现在结果里，由调用方判定。

        Args: session, codes。
        """
        if not codes:
            return {}
        rows = await session.execute(
            select(Permission.code, Permission.id).where(
                Permission.code.in_(codes)
            )
        )
        return {code: permission_id for code, permission_id in rows.all()}

    async def builtin_codes(self, session: AsyncSession) -> frozenset[str]:
        """内置码集合。全权判定以它为基准，手工建码不影响判定。"""
        result = await session.execute(
            select(Permission.code).where(Permission.is_builtin.is_(True))
        )
        return frozenset(result.scalars().all())

    async def count_builtin(self, session: AsyncSession) -> int:
        """内置码数量。全权账号计数用它做门槛。"""
        result = await session.execute(
            select(func.count())
            .select_from(Permission)
            .where(Permission.is_builtin.is_(True))
        )
        return int(result.scalar_one())


permission_crud = PermissionCrud()
