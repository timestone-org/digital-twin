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
from knowledge_server.apps.knowledge.errors import ChunkNotFound
from knowledge_server.apps.knowledge.models import (
    KnowledgeChunk,
    KnowledgeDocument,
)
from knowledge_server.apps.knowledge.schemas.chunk import (
    ChunkWindowIn,
    ChunkWindowOut,
)
from knowledge_server.apps.knowledge.schemas.search import LocatorOut

# 前后各带几块
NEIGHBOURS = 1


async def read_window(
    session: AsyncSession,
    base_id: uuid.UUID,
    chunk_id: uuid.UUID,
    window: ChunkWindowIn,
) -> ChunkWindowOut:
    """按原块身份返回正文窗口；Args: session, base_id, chunk_id, window。"""
    found = await read_around(session, chunk_id)
    if found is None or found.base_id != base_id:
        raise ChunkNotFound("知识块不存在，请重新检索取得当前块身份")
    text = found.text[window.offset : window.offset + window.limit]
    next_offset = window.offset + len(text)
    has_more = next_offset < len(found.text)
    return ChunkWindowOut(
        base_id=base_id,
        chunk_id=chunk_id,
        document_title=found.document_title,
        heading_path=found.heading_path,
        locator=LocatorOut.model_validate(found.locator),
        text=text,
        offset=window.offset,
        total_chars=len(found.text),
        has_more=has_more,
        next_offset=next_offset if has_more else None,
    )


@dataclass(frozen=True)
class ChunkContext:
    """一块原文与它的前后文。"""

    # 这一块属于哪个库。⚠ 一并带出来不是为了显示：对话面要拿它判这一块在不在
    # 这次对话的范围里，而 `chunk_id` 可以是模型从历史消息里翻出来的
    base_id: uuid.UUID
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
        base_id=row.base_id,
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
