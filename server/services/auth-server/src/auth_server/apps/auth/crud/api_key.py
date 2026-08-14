"""API 密钥的数据访问。只做查询与挂载，不提交——事务边界归 service 层。"""

import uuid

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.models import ApiKey
from lib.db import CrudBase

DEFAULT_ORDER = (ApiKey.created_at.desc(), ApiKey.id.desc())


class ApiKeyCrud(CrudBase[ApiKey]):
    """`auth_api_keys` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(ApiKey)

    @staticmethod
    async def get_by_prefix(
        session: AsyncSession, prefix: str
    ) -> ApiKey | None:
        """按明文前缀取一行。认证热路径就这一次查询。

        ⚠ 前缀不做大小写归一：它由服务端生成，逐字相等才是同一枚密钥。

        Args: session, prefix。
        """
        result = await session.execute(
            select(ApiKey).where(ApiKey.prefix == prefix)
        )
        return result.scalars().one_or_none()

    @staticmethod
    def build_query(
        *, user_id: uuid.UUID | None, should_include_revoked: bool
    ) -> Select[tuple[ApiKey]]:
        """按白名单条件构造列表查询。

        Args: user_id, should_include_revoked。
        """
        statement = select(ApiKey)
        if user_id is not None:
            statement = statement.where(ApiKey.user_id == user_id)
        if not should_include_revoked:
            statement = statement.where(ApiKey.revoked_at.is_(None))
        return statement


api_key_crud = ApiKeyCrud()
