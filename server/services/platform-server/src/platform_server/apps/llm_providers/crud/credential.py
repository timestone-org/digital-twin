"""登录态那一行的数据访问。只读写，不提交。"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.llm_providers.models import LlmProviderCredential


async def by_provider(
    session: AsyncSession, provider_id: uuid.UUID
) -> LlmProviderCredential | None:
    """取某一路的那一行；没登录过给 `None`。

    Args: session, provider_id。
    """
    rows = await session.execute(
        select(LlmProviderCredential).where(
            LlmProviderCredential.provider_id == provider_id
        )
    )
    return rows.scalars().one_or_none()


async def by_provider_for_update(
    session: AsyncSession, provider_id: uuid.UUID
) -> LlmProviderCredential | None:
    """取那一行并锁住它，用于续期写回。

    ⚠ 续期是「读—改—写」：不锁的话，两个副本同时续期会各拿一份新令牌，
    后写的那份把先写的顶掉——而被顶掉的那一份已经发给上游用过了。

    Args: session, provider_id。
    """
    rows = await session.execute(
        select(LlmProviderCredential)
        .where(LlmProviderCredential.provider_id == provider_id)
        .with_for_update()
    )
    return rows.scalars().one_or_none()


def add(
    session: AsyncSession, row: LlmProviderCredential
) -> LlmProviderCredential:
    """挂进会话。取 id 用 flush，**不要 commit**。

    Args: session, row。
    """
    session.add(row)
    return row
