"""实例凭据的数据访问。

⚠ 这一层只搬散列，不做校验：核对口令是 service 层的事，
且必须走 `lib.auth.PasswordHasher.verify`，不许在这里比字符串。
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from opcua_server.apps.instance.models import Credential


class CredentialCrud(CrudBase[Credential]):
    """`opcua_instance_credentials` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(Credential)

    async def get_by_username(
        self, session: AsyncSession, *, instance_id: uuid.UUID, username: str
    ) -> Credential | None:
        """按实例内的用户名取凭据。

        Args: session, instance_id, username。
        """
        result = await session.execute(
            select(Credential).where(
                Credential.instance_id == instance_id,
                Credential.username == username,
            )
        )
        return result.scalars().one_or_none()

    async def list_of_instance(
        self, session: AsyncSession, instance_id: uuid.UUID
    ) -> list[Credential]:
        """取某实例的全部凭据，供启动时装配 user_manager。

        Args: session, instance_id。
        """
        result = await session.execute(
            select(Credential)
            .where(Credential.instance_id == instance_id)
            .order_by(Credential.username.asc())
        )
        return list(result.scalars().all())


credential_crud = CredentialCrud()
