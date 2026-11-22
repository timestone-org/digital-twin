"""内容写入先锁本库，再接触具体来源、文档或块。"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.models import (
    KnowledgeBase,
    KnowledgeDocument,
    KnowledgeSource,
)


async def base(session: AsyncSession, identity: uuid.UUID) -> None:
    """与库内容修订使用同级行锁。Args: session, identity。"""
    await session.execute(
        select(KnowledgeBase.id)
        .where(KnowledgeBase.id == identity)
        .with_for_update(key_share=True)
    )


async def document(session: AsyncSession, identity: uuid.UUID) -> None:
    """按文档身份锁库，尚未锁文档行。Args: session, identity。"""
    await session.execute(
        select(KnowledgeBase.id)
        .join(KnowledgeDocument, KnowledgeDocument.base_id == KnowledgeBase.id)
        .where(KnowledgeDocument.id == identity)
        .with_for_update(of=KnowledgeBase, key_share=True)
    )


async def source(session: AsyncSession, identity: uuid.UUID) -> None:
    """按来源身份锁库，尚未锁来源行。Args: session, identity。"""
    await session.execute(
        select(KnowledgeBase.id)
        .join(KnowledgeSource, KnowledgeSource.base_id == KnowledgeBase.id)
        .where(KnowledgeSource.id == identity)
        .with_for_update(of=KnowledgeBase, key_share=True)
    )
