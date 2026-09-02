"""看一块原文，连前后各一块：给对话面的「看上下文」用。

⚠ 这一层是对话模块能碰到知识库表的**唯一入口**：跨功能模块只走 services
公开面（结构闸守着），让它自己去 `select` 块表等于两个模块的表结构从此绑死。
"""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.models import (
    KnowledgeChunk,
    KnowledgeDocument,
)

# 前后各带几块
NEIGHBOURS = 1


@dataclass(frozen=True)
class ChunkContext:
    """一块原文与它的前后文。"""

    document_title: str
    heading_path: str
    locator: dict[str, Any]
    before: tuple[str, ...]
    text: str
    after: tuple[str, ...]


async def read_around(
    session: AsyncSession, chunk_id: uuid.UUID
) -> ChunkContext | None:
    """这一块连前后各 `NEIGHBOURS` 块；没有这一块给 `None`。

    Args: session, chunk_id。
    """
    rows = await crud.chunk.chunks_by_ids(session, [chunk_id])
    if not rows:
        return None
    row = rows[0]
    around = await session.execute(
        select(KnowledgeChunk)
        .where(
            KnowledgeChunk.document_id == row.document_id,
            KnowledgeChunk.ordinal >= row.ordinal - NEIGHBOURS,
            KnowledgeChunk.ordinal <= row.ordinal + NEIGHBOURS,
            KnowledgeChunk.id != row.id,
        )
        .order_by(KnowledgeChunk.ordinal.asc())
    )
    neighbours = list(around.scalars().all())
    title = await session.execute(
        select(KnowledgeDocument.title).where(
            KnowledgeDocument.id == row.document_id
        )
    )
    return ChunkContext(
        document_title=str(title.scalar_one_or_none() or ""),
        heading_path=row.heading_path,
        locator=row.locator_json,
        before=tuple(
            one.text for one in neighbours if one.ordinal < row.ordinal
        ),
        text=row.text,
        after=tuple(
            one.text for one in neighbours if one.ordinal > row.ordinal
        ),
    )
