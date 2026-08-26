"""模型凭据的数据访问。只读写，不提交。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.credential.models import ModelCredential
from lib.db import CrudBase


class CredentialCrud(CrudBase[ModelCredential]):
    """`model_credentials` 的数据访问。一路模型一行。"""

    def __init__(self) -> None:
        super().__init__(ModelCredential)

    async def by_provider(
        self, session: AsyncSession, provider: str
    ) -> ModelCredential | None:
        """取某一路模型的那一行；没登录过给 `None`。

        Args: session, provider。
        """
        rows = await session.execute(
            select(ModelCredential).where(ModelCredential.provider == provider)
        )
        return rows.scalars().one_or_none()

    async def by_provider_for_update(
        self, session: AsyncSession, provider: str
    ) -> ModelCredential | None:
        """取那一行并锁住它，用于刷新写回。

        ⚠ 刷新是「读—改—写」：不锁的话，两个副本同时刷新会各拿一份新令牌，
        后写的那份把先写的顶掉——而被顶掉的那一份已经发给上游用过了。

        Args: session, provider。
        """
        rows = await session.execute(
            select(ModelCredential)
            .where(ModelCredential.provider == provider)
            .with_for_update()
        )
        return rows.scalars().one_or_none()


credential_crud = CredentialCrud()
