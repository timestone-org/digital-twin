"""用途分配行的数据访问。只做查询与写入，**不提交**。"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.llm_providers.models import LlmAssignment


async def list_all(session: AsyncSession) -> list[LlmAssignment]:
    """全部分配行。

    Args: session。
    """
    rows = await session.execute(
        select(LlmAssignment).order_by(LlmAssignment.purpose.asc())
    )
    return list(rows.scalars().all())


async def get(session: AsyncSession, purpose: str) -> LlmAssignment | None:
    """按用途取一行；没有给 None。

    Args: session, purpose。
    """
    return await session.get(LlmAssignment, purpose)


async def purposes_of(
    session: AsyncSession, provider_id: uuid.UUID
) -> list[str]:
    """此刻指着这一路的用途码。

    Args: session, provider_id。
    """
    rows = await session.execute(
        select(LlmAssignment.purpose)
        .where(LlmAssignment.provider_id == provider_id)
        .order_by(LlmAssignment.purpose.asc())
    )
    return list(rows.scalars().all())


async def count_for(session: AsyncSession, provider_id: uuid.UUID) -> int:
    """指着这一路的用途有几个。

    Args: session, provider_id。
    """
    total = await session.scalar(
        select(func.count())
        .select_from(LlmAssignment)
        .where(LlmAssignment.provider_id == provider_id)
    )
    return int(total or 0)


def add(session: AsyncSession, row: LlmAssignment) -> LlmAssignment:
    """挂进会话。**不要 commit**。

    Args: session, row。
    """
    session.add(row)
    return row


async def delete(session: AsyncSession, row: LlmAssignment) -> None:
    """删一行。

    Args: session, row。
    """
    await session.delete(row)
