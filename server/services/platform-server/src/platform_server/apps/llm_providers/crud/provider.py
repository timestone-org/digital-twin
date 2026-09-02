"""供应商行的数据访问。只做查询与写入，**不提交**。"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.llm_providers.models import LlmProvider


async def list_page(
    session: AsyncSession, *, offset: int, limit: int
) -> tuple[list[LlmProvider], int]:
    """按名字排序取一页与总数。

    Args: session, offset, limit。
    """
    total = await session.scalar(select(func.count()).select_from(LlmProvider))
    rows = await session.execute(
        select(LlmProvider)
        .order_by(LlmProvider.name.asc())
        .offset(offset)
        .limit(limit)
    )
    return list(rows.scalars().all()), int(total or 0)


async def list_all(session: AsyncSession) -> list[LlmProvider]:
    """全部供应商，按名字排序。给目录装配用——那一份要全量。

    Args: session。
    """
    rows = await session.execute(
        select(LlmProvider).order_by(LlmProvider.name.asc())
    )
    return list(rows.scalars().all())


async def get(
    session: AsyncSession, provider_id: uuid.UUID
) -> LlmProvider | None:
    """按 id 取一行；没有给 None。

    Args: session, provider_id。
    """
    return await session.get(LlmProvider, provider_id)


async def by_name(session: AsyncSession, name: str) -> LlmProvider | None:
    """按名字取一行；没有给 None。

    Args: session, name。
    """
    rows = await session.execute(
        select(LlmProvider).where(LlmProvider.name == name)
    )
    return rows.scalars().one_or_none()


def add(session: AsyncSession, row: LlmProvider) -> LlmProvider:
    """挂进会话。取 id 用 flush，**不要 commit**。

    Args: session, row。
    """
    session.add(row)
    return row


async def delete(session: AsyncSession, row: LlmProvider) -> None:
    """删一行。

    Args: session, row。
    """
    await session.delete(row)
