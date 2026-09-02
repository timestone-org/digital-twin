"""模型凭据的数据访问。只读写，不提交。

⚠ 认行按 `coalesce(provider_ref, provider)`：目录里配出来的那几路各带自己的
供应商 id，而环境变量那一路（连同存量那一行）只有种类那一格。少了 coalesce
的表现是「升级之后订阅账号忽然说没登录」，而库里那一行好端端躺着。
"""

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.credential.models import ModelCredential
from lib.db import CrudBase


class CredentialCrud(CrudBase[ModelCredential]):
    """`model_credentials` 的数据访问。一路供应商一行。"""

    def __init__(self) -> None:
        super().__init__(ModelCredential)

    async def by_provider(
        self, session: AsyncSession, provider: str
    ) -> ModelCredential | None:
        """取某一路的那一行；没登录过给 `None`。

        Args: session, provider（目录里那一路的 id，或环境变量那一路的种类）。
        """
        rows = await session.execute(_where(select(ModelCredential), provider))
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
            _where(select(ModelCredential), provider).with_for_update()
        )
        return rows.scalars().one_or_none()


def _where(
    statement: Select[tuple[ModelCredential]], provider: str
) -> Select[tuple[ModelCredential]]:
    """按键认那一行。

    Args: statement, provider。
    """
    return statement.where(
        func.coalesce(ModelCredential.provider_ref, ModelCredential.provider)
        == provider
    )


credential_crud = CredentialCrud()
