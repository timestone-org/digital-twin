"""图行与块—图联结行的数据访问。只做查询与写入，**不提交**。"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.models import (
    KnowledgeChunkFigure,
    KnowledgeFigure,
)


@dataclass(frozen=True)
class FigureWrite:
    """要落的一行图。"""

    ordinal: int
    kind: str
    page: int | None
    caption: str
    object_key: str
    media_type: str
    byte_size: int
    content_hash: str
    bbox: dict[str, int]


async def replace_figures(
    session: AsyncSession,
    base_id: uuid.UUID,
    document_id: uuid.UUID,
    rows: Sequence[FigureWrite],
) -> dict[str, uuid.UUID]:
    """整份文档的图**整体替换**，回「内容哈希 → 图 id」。

    ⚠ 先删再插而不是增量：重新解析之后图的序号会变，而一一对应的更新要先算出
    「哪一张还是原来那一张」——那件事只有内容哈希答得上，而哈希一样就意味着
    这一行本来也不用改。

    ⚠ 联结行随外键级联删掉，所以调用方必须紧接着重建它们。

    Args: session, base_id, document_id, rows。
    """
    await session.execute(
        delete(KnowledgeFigure).where(
            KnowledgeFigure.document_id == document_id
        )
    )
    made = [
        KnowledgeFigure(
            base_id=base_id,
            document_id=document_id,
            ordinal=one.ordinal,
            kind=one.kind,
            page=one.page,
            caption=one.caption,
            object_key=one.object_key,
            media_type=one.media_type,
            byte_size=one.byte_size,
            content_hash=one.content_hash,
            bbox_json=one.bbox,
        )
        for one in rows
    ]
    session.add_all(made)
    await session.flush()
    return {one.content_hash: one.id for one in made}


async def link_figures(
    session: AsyncSession, links: Sequence[tuple[uuid.UUID, uuid.UUID, int]]
) -> int:
    """把「这一块引了这张图」写进联结表，回写了几行。

    Args: session, links（chunk_id, figure_id, ordinal）。
    """
    if not links:
        return 0
    session.add_all(
        [
            KnowledgeChunkFigure(
                chunk_id=chunk_id, figure_id=figure_id, ordinal=at
            )
            for chunk_id, figure_id, at in links
        ]
    )
    await session.flush()
    return len(links)


async def get_figure(
    session: AsyncSession, document_id: uuid.UUID, figure_id: uuid.UUID
) -> KnowledgeFigure | None:
    """取一张图，**连它属于哪份文档一起判**。

    ⚠ 不许只按 figure_id 取：取图端点的路径里带着文档 id，而那是调用方已经
    按权限核过的那一格。只按图 id 取的话，换一个文档 id 就能把别的库的图
    取出来——而那两个 id 单看都是合法的 uuid。

    Args: session, document_id, figure_id。
    """
    found = await session.execute(
        select(KnowledgeFigure).where(
            KnowledgeFigure.id == figure_id,
            KnowledgeFigure.document_id == document_id,
        )
    )
    return found.scalar_one_or_none()


async def figures_of_document(
    session: AsyncSession, document_id: uuid.UUID
) -> list[KnowledgeFigure]:
    """一份文档的全部图，按序号。

    Args: session, document_id。
    """
    found = await session.execute(
        select(KnowledgeFigure)
        .where(KnowledgeFigure.document_id == document_id)
        .order_by(KnowledgeFigure.ordinal)
    )
    return list(found.scalars())


async def figures_of_chunks(
    session: AsyncSession, chunk_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[KnowledgeFigure]]:
    """这几块各自引了哪几张图。

    ⚠ 一次查完再按块分组，不在调用方那里逐块查：引用面一次要摊十来块，
    逐块查就是十来个往返（N+1）。

    Args: session, chunk_ids。
    """
    if not chunk_ids:
        return {}
    found = await session.execute(
        select(KnowledgeChunkFigure.chunk_id, KnowledgeFigure)
        .join(
            KnowledgeFigure,
            KnowledgeFigure.id == KnowledgeChunkFigure.figure_id,
        )
        .where(KnowledgeChunkFigure.chunk_id.in_(chunk_ids))
        .order_by(KnowledgeChunkFigure.ordinal)
    )
    made: dict[uuid.UUID, list[KnowledgeFigure]] = {}
    for chunk_id, figure in found.all():
        made.setdefault(chunk_id, []).append(figure)
    return made
